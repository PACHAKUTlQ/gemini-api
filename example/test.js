const apiKey = '';
const url = 'https://your-website.com/v1/chat/completions';

const prompt = "Hello. What can you do?";

const data = {
  model: "gemini-1.5-flash-latest",
  messages: [{
    role: "user",
    content: prompt
  }],
  temperature: 0.7,
};

fetch(url, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(data)
})
.then(response => {
  if (response.ok) {
    return response.json();
  } else {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
})
.then(data => {
  console.log(data.choices[0].message.content);
})
.catch(error => {
  console.error('Error:', error);
});