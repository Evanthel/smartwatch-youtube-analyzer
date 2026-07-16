# SmartWatch Legal and Safety Notes

See also the repository [privacy policy](../PRIVACY.md).

## Data Handling

- Authentication information: the Gemini API key is stored locally in `chrome.storage.local`.
- User-provided content: the saved goal text and custom prompt template are stored locally in `chrome.storage.local`.
- Website content: the extension reads transcript text from the current YouTube video when you click `Analyze`.
- Web browsing activity: the extension checks whether the active tab is a supported YouTube watch page and reads the current YouTube URL/video ID for that feature.
- During analysis, the current goal and retrieved transcript are sent to Google Gemini through the Generative Language API.
- The extension does not send data to any project-owned backend because there is no project-owned server in this repository.
- SmartWatch does not sell personal data, share data with advertising networks, or use data for creditworthiness or lending decisions.

## Permissions

SmartWatch requests these Chrome permissions:

- `activeTab`: reads the active tab context so SmartWatch can confirm the current page is a YouTube watch page.
- `storage`: stores your Gemini API key, selected model, saved goal, and custom prompt template locally in Chrome extension storage.
- `scripting`: injects the content script when needed so transcript extraction can run on the current YouTube watch page.
- `sidePanel`: displays the SmartWatch user interface in Chrome's side panel.
- `webNavigation`: keeps side panel availability synchronized as YouTube changes videos through in-page navigation.
- `https://www.youtube.com/*` and `https://m.youtube.com/*`: limits transcript detection and extraction to YouTube pages.

## Disclaimer

- You are responsible for the prompts, goals, API key, custom templates, model settings, and any other input sent through the extension.
- You are also responsible for reviewing and using the model output. The developer does not control or pre-review Gemini responses to user prompts.
- Model output may be inaccurate, incomplete, biased, or misleading. No warranty or guarantee is provided for correctness, fitness, or usefulness.
- This tool is not legal, medical, financial, compliance, or other professional advice, and it should not be used as the sole basis for high-stakes or safety-critical decisions.
- Do not submit secrets, confidential business data, or sensitive personal information unless you accept the risk of sending that content to Gemini.
- Use of Gemini through this extension is also subject to Google's terms and privacy policies.
- You are responsible for ensuring that your use of YouTube content, transcripts, and generated outputs complies with applicable laws, platform terms, and any relevant rights or permissions.
- By using SmartWatch, you confirm that you are old enough to use Chrome, YouTube, Google Gemini or Google AI Studio, and Chrome Web Store extensions in your jurisdiction.

## Acceptable Use / Not for High-Risk Use

- Do not use this project for illegal activity, harassment, exploitation, disinformation, privacy violations, or other harmful conduct.
- Do not rely on this project in high-risk contexts such as medical, legal, financial, employment, compliance, safety-critical, or emergency-response decisions.
- If you choose to use or modify this project, you are responsible for how it is applied and for validating outputs before acting on them.
