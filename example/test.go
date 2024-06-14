package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"net/http"
)

const (
	apiKey = "Hello. What can you do?" // Replace with your actual API key
	url    = "https://your-api-url.com/v1/chat/completions"
)

func main() {
	prompt := "Hello. What can you do?"

	data := map[string]interface{}{
		"model": "gemini-1.5-flash-latest",
		"messages": []map[string]string{
			{
				"role":    "user",
				"content": prompt,
			},
		},
		"temperature": 0.7,
	}

	jsonData, err := json.Marshal(data)
	if err != nil {
		fmt.Printf("Error: %v\n", err)
		return
	}

	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		fmt.Printf("Error: %v\n", err)
		return
	}

	req.Header.Add("Authorization", "Bearer "+apiKey)
	req.Header.Add("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		fmt.Printf("Error: %v\n", err)
		return
	}
	defer resp.Body.Close()

	body, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		fmt.Printf("Error reading response: %v\n", err)
		return
	}

	if resp.StatusCode == 200 {
		var result map[string]interface{}
		if err := json.Unmarshal(body, &result); err != nil {
			fmt.Printf("Error unmarshalling response: %v\n", err)
			return
		}
		choices := result["choices"].([]interface{})
		firstChoice := choices[0].(map[string]interface{})
		message := firstChoice["message"].(map[string]interface{})
		content := message["content"].(string)
		fmt.Println(content)
	} else {
		fmt.Printf("Error: %v\n", resp.StatusCode)
		fmt.Println(string(body))
	}
}