import { Buffer } from "node:buffer";
// alt: import { base64url } from "rfc4648";

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return handleOPTIONS();
    }
    const url = new URL(request.url);
    if (
      !url.pathname.endsWith("/v1/chat/completions") ||
      request.method !== "POST"
    ) {
      return new Response("404 Not Found", { status: 404 });
    }
    const auth = request.headers.get("Authorization");
    let apiKey = auth && auth.split(" ")[1];
    if (!apiKey) {
      return new Response("Bad credentials", { status: 401 });
    }
    let json;
    try {
      json = await request.json();
      if (!Array.isArray(json.messages)) {
        throw SyntaxError(".messages array required");
      }
    } catch (err) {
      console.error(err.toString());
      return new Response(err, { status: 400 });
    }
    return handleRequest(json, apiKey);
  },
};

const handleOPTIONS = async () => {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "*",
      "Access-Control-Allow-Headers": "*",
    },
  });
};

const BASE_URL = "https://generativelanguage.googleapis.com";
const API_VERSION = "v1beta";
// https://github.com/google/generative-ai-js/blob/0931d2ce051215db72785d76fe3ae4e0bc3b5475/packages/main/src/requests/request.ts#L67
const API_CLIENT = "genai-js/0.19.0"; // npm view @google/generative-ai version
async function handleRequest(req, apiKey) {
  let MODEL;
  const oldModels = [
    // "gemma-2-2b-it",
    // "gemma-2-9b-it",
    // "gemma-2-27b-it",
    "gpt-4o-mini",
    "gpt-3.5",
    "gpt-3.5-turbo",
    "gpt-3.5-turbo-0125",
  ];
  const proModels = [
    // "gemini-1.5-pro",
    // "gemini-1.5-pro-002",
    // "gemini-1.5-pro-latest",
    // "gemini-1.5-pro-exp-0827",
    "gpt-4o",
    "gpt-4o-latest",
    "gpt-4o-latest-20240903",
    "gpt-4o-2024-08-06",
  ];
  const flashModels = [
    // "gemini-1.5-flash",
    // "gemini-1.5-flash-002",
    // "gemini-1.5-flash-latest",
    // "gemini-1.5-flash-exp-0827",
    "gpt-4",
    "gpt-4-turbo",
  ];

  if (req.model.startsWith("gemini") || req.model.startsWith("gemma")) {
    MODEL = req.model;
  } else {
    if (oldModels.includes(req.model)) {
      MODEL = "gemma-2-27b-it";
    } else if (proModels.includes(req.model)) {
      MODEL = "gemini-1.5-pro-002";
    } else if (flashModels.includes(req.model)) {
      MODEL = "gemini-1.5-flash-002";
    } else {
      throw new Error("Invalid model parameter");
    }
  }

  const TASK = req.stream ? "streamGenerateContent" : "generateContent";
  let url = `${BASE_URL}/${API_VERSION}/models/${MODEL}:${TASK}`;
  if (req.stream) {
    url += "?alt=sse";
  }
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
        "x-goog-api-client": API_CLIENT,
      },
      body: JSON.stringify(await transformRequest(req)), // try
    });
  } catch (err) {
    console.error(err);
    return new Response(err, {
      status: 400,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  }

  let body;
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  if (response.ok) {
    let id = generateChatcmplId(); //"chatcmpl-8pMMaqXMK68B3nyDBrapTDrhkHBQK";
    if (req.stream) {
      body = response.body
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(
          new TransformStream({
            transform: parseStream,
            flush: parseStreamFlush,
            buffer: "",
          }),
        )
        .pipeThrough(
          new TransformStream({
            transform: toOpenAiStream,
            flush: toOpenAiStreamFlush,
            MODEL,
            id,
            last: [],
          }),
        )
        .pipeThrough(new TextEncoderStream());
    } else {
      body = await response.text();
      try {
        body = await processResponse(JSON.parse(body), MODEL, id);
      } catch (err) {
        console.error(err);
        response = { status: 500 };
        headers.set("Content-Type", "text/plain");
      }
    }
  } else {
    // Error: [400 Bad Request] User location is not supported for the API use.
    body = await response.text();
    try {
      const { code, status, message } = JSON.parse(body).error;
      body = `Error: [${code} ${status}] ${message}`;
    } catch (err) {
      // pass body as is
    }
    headers.set("Content-Type", "text/plain");
    //headers.delete("Transfer-Encoding");
  }
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const harmCategory = [
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_CIVIC_INTEGRITY",
];
const safetySettings = harmCategory.map((category) => ({
  category,
  threshold: "BLOCK_NONE",
}));
const fieldsMap = {
  stop: "stopSequences",
  n: "candidateCount", // { "error": { "code": 400, "message": "Only one candidate can be specified", "status": "INVALID_ARGUMENT" } }
  max_tokens: "maxOutputTokens",
  temperature: "temperature",
  top_p: "topP",
  //..."topK"
};
const transformConfig = (req) => {
  let cfg = {};
  //if (typeof req.stop === "string") { req.stop = [req.stop]; } // no need
  for (let key in req) {
    const matchedKey = fieldsMap[key];
    if (matchedKey) {
      cfg[matchedKey] = req[key];
    }
  }
  if (req.response_format?.type === "json_object") {
    cfg.response_mime_type = "application/json";
  }
  return cfg;
};

const parseImg = async (url) => {
  let mimeType, data;
  if (url.startsWith("http://") || url.startsWith("https://")) {
    try {
      const response = await fetch(url);
      mimeType = response.headers.get("content-type");
      data = Buffer.from(await response.arrayBuffer()).toString("base64");
    } catch (err) {
      throw Error("Error fetching image: " + err.toString());
    }
  } else {
    const match = url.match(/^data:(?<mimeType>.*?)(;base64)?,(?<data>.*)$/);
    if (!match) {
      throw Error("Invalid image data: " + url);
    }
    ({ mimeType, data } = match.groups);
  }
  return {
    inlineData: {
      mimeType,
      data,
    },
  };
};

const transformMsg = async ({ role, content }) => {
  const parts = [];
  if (!Array.isArray(content)) {
    // system, user: string
    // assistant: string or null (Required unless tool_calls is specified.)
    parts.push({ text: content });
    return { role, parts };
  }
  // OpenAI "model": "gpt-4-vision-preview"
  // user:
  // An array of content parts with a defined type, each can be of type text or image_url when passing in images.
  // You can pass multiple images by adding multiple image_url content parts.
  // Image input is only supported when using the gpt-4-visual-preview model.
  for (const item of content) {
    switch (item.type) {
      case "text":
        parts.push({ text: item.text });
        break;
      case "image_url":
        parts.push(await parseImg(item.image_url.url));
        break;
      default:
        throw TypeError(`Unknown "content" item type: "${item.type}"`);
    }
  }
  return { role, parts };
};

const transformMessages = async (messages) => {
  const contents = [];
  let system_instruction;
  for (const item of messages) {
    if (item.role === "system") {
      delete item.role;
      system_instruction = await transformMsg(item);
    } else {
      item.role = item.role === "assistant" ? "model" : "user";
      contents.push(await transformMsg(item));
    }
  }
  if (system_instruction && contents.length === 0) {
    contents.push({ role: "model", parts: { text: " " } });
  }
  //console.info(JSON.stringify(contents, 2));
  return { system_instruction, contents };
};

const transformRequest = async (req) => ({
  ...(await transformMessages(req.messages)),
  safetySettings,
  generationConfig: transformConfig(req),
});

const generateChatcmplId = () => {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const randomChar = () =>
    characters[Math.floor(Math.random() * characters.length)];
  return "chatcmpl-" + Array.from({ length: 29 }, randomChar).join("");
};

const reasonsMap = {
  //https://ai.google.dev/api/rest/v1/GenerateContentResponse#finishreason
  //"FINISH_REASON_UNSPECIFIED": // Default value. This value is unused.
  STOP: "stop",
  MAX_TOKENS: "length",
  SAFETY: "content_filter",
  RECITATION: "content_filter",
  //"OTHER": "OTHER",
  // :"function_call",
};
const transformCandidates = (key, cand) => ({
  index: cand.index || 0, // 0-index is absent in new -002 models response
  [key]: { role: "assistant", content: cand.content?.parts[0].text },
  logprobs: null,
  finish_reason: reasonsMap[cand.finishReason] || cand.finishReason,
});
const transformCandidatesMessage = transformCandidates.bind(null, "message");
const transformCandidatesDelta = transformCandidates.bind(null, "delta");

const transformUsage = (data) => ({
  completion_tokens: data.candidatesTokenCount,
  prompt_tokens: data.promptTokenCount,
  total_tokens: data.totalTokenCount,
});

const processResponse = async (data, model, id) => {
  return JSON.stringify({
    id,
    choices: data.candidates.map(transformCandidatesMessage),
    created: Math.floor(Date.now() / 1000),
    model,
    //system_fingerprint: "fp_69829325d0",
    object: "chat.completion",
    usage: transformUsage(data.usageMetadata),
  });
};

const responseLineRE = /^data: (.*)(?:\n\n|\r\r|\r\n\r\n)/;
async function parseStream(chunk, controller) {
  chunk = await chunk;
  if (!chunk) {
    return;
  }
  this.buffer += chunk;
  do {
    const match = this.buffer.match(responseLineRE);
    if (!match) {
      break;
    }
    controller.enqueue(match[1]);
    this.buffer = this.buffer.substring(match[0].length);
  } while (true); // eslint-disable-line no-constant-condition
}
async function parseStreamFlush(controller) {
  if (this.buffer) {
    console.error("Invalid data:", this.buffer);
    controller.enqueue(this.buffer);
  }
}

function transformResponseStream(data, stop, first) {
  const item = transformCandidatesDelta(data.candidates[0]);
  if (stop) {
    item.delta = {};
  } else {
    item.finish_reason = null;
  }
  if (first) {
    item.delta.content = "";
  } else {
    delete item.delta.role;
  }
  const output = {
    id: this.id,
    choices: [item],
    created: Math.floor(Date.now() / 1000),
    model: this.model,
    //system_fingerprint: "fp_69829325d0",
    object: "chat.completion.chunk",
  };
  if (stop && data.usageMetadata) {
    output.usage = transformUsage(data.usageMetadata);
  }
  return "data: " + JSON.stringify(output) + delimiter;
}
const delimiter = "\n\n";
async function toOpenAiStream(chunk, controller) {
  const transform = transformResponseStream.bind(this);
  const line = await chunk;
  if (!line) {
    return;
  }
  let data;
  try {
    data = JSON.parse(line);
  } catch (err) {
    console.error(line);
    console.error(err);
    const length = this.last.length || 1; // at least 1 error msg
    const candidates = Array.from({ length }, (_, index) => ({
      finishReason: "error",
      content: { parts: [{ text: err }] },
      index,
    }));
    data = { candidates };
  }
  const cand = data.candidates[0]; // !!untested with candidateCount>1
  cand.index = cand.index || 0; // absent in new -002 models response
  if (!this.last[cand.index]) {
    controller.enqueue(transform(data, false, "first"));
  }
  this.last[cand.index] = data;
  if (cand.content) {
    // prevent empty data (e.g. when MAX_TOKENS)
    controller.enqueue(transform(data));
  }
}
async function toOpenAiStreamFlush(controller) {
  const transform = transformResponseStream.bind(this);
  if (this.last.length > 0) {
    for (const data of this.last) {
      controller.enqueue(transform(data, "stop"));
    }
    controller.enqueue("data: [DONE]" + delimiter);
  }
}
