# Instagram Chat Exporter

Browser console script to export Instagram DMs as JSON. Intercepts live GraphQL traffic to capture auth credentials, paginates through messages, and downloads the result.

## Usage

1. Open [instagram.com](https://www.instagram.com) in your browser and navigate to any DM thread.

2. Open the browser DevTools console (`F12` → Console tab).

3. **First time only:** The console may block pasting. Click the console input, type `allow pasting`, and press Enter to enable it.

4. Paste the entire contents of [`insta-chat-export.js`](https://github.com/Meghdut-Mandal/instagram-chat-exporter/blob/main/insta-chat-export.js) and press Enter.

5. You'll see:
   ```
   📡 Interceptors active — scroll in a DM thread to trigger a GraphQL request...
   ```

6. **Scroll up** in the DMs to trigger an Instagram GraphQL request. Once captured:
   ```
   Details captured! Thread ID: <id>, doc_id: <id>
   ```

7. The script fetches the last **30 days** of messages (20 per page) and logs progress:
   ```
   Fetched messages count: 40 .. Last message "hey what's up"
   ```

8. When complete, a JSON file is automatically downloaded:
   ```
   instagram_conversation_<thread_id>.json
   ```

## Configuration

At the top of the script, two constants control behavior:

| Constant | Default | Description |
|---|---|---|
| `MESSAGES_PER_PAGE` | `20` | Messages fetched per API request |
| `DAYS` | `30` | How far back to fetch messages |

## Output Format

```json
{
  "exported_at": "2026-03-25T12:00:00.000Z",
  "thread_id": "340282...",
  "days_fetched": 30,
  "message_count": 142,
  "messages": [
    {
      "message_id": "...",
      "sender_name": "Jane Doe",
      "sender_username": "janedoe",
      "sender_fbid": "123456789",
      "text": "Hello!",
      "timestamp_ms": 1742000000000,
      "timestamp_iso": "2026-03-10T08:00:00.000Z",
      "content_type": "TEXT",
      "reactions": [],
      "replied_to_message_id": null
    }
  ]
}
```

Messages are sorted oldest → newest.

## Notes

- The script restores all intercepted browser APIs (`fetch`, `XMLHttpRequest`) after capturing credentials — normal page behavior is unaffected.
- A 300 ms delay is added between page requests to avoid rate limiting.
- The script times out after **60 seconds** if no GraphQL request is detected. If that happens, try scrolling in the DM thread again.
- Only works while you are logged in to Instagram in the same browser session.
