import requests

api_key = ""

prompt = """Hello. What can you do?"""

url = "https://your-api-url.com/v1/chat/completions"

headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json",
}

data = {
    "model": "gemini-1.5-flash-latest",
    "messages": [{
        "role": "user",
        "content": prompt
    }],
    "temperature": 0.7,
}

response = requests.post(url, headers=headers, json=data)

if response.status_code == 200:
    print(response.json()["choices"][0]["message"]["content"])
else:
    print(f"Error: {response.status_code}")
    print(response.text)
