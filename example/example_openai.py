from openai import OpenAI

api_key = ""

system_prompt = ""

prompt = """Hello. What can you do?"""

api_base = "https://your-api-url.com/v1"

model = "gemini-1.5-flash-latest"

client = OpenAI(base_url=api_base, api_key=api_key)

completion = client.chat.completions.create(
    model=model,
    messages=[{
        "role": "system",
        "content": system_prompt
    }, {
        "role": "user",
        "content": prompt
    }],
)

print(completion.choices[0].message.content.strip())
