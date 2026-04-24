# Privacy Policy for SmartWatch

## Summary

SmartWatch analyzes the transcript of the currently open YouTube watch page against a goal you enter in the extension UI.

SmartWatch only operates on YouTube watch pages with accessible transcript or caption data. It does not intentionally collect browsing history outside supported YouTube watch pages.

## Data We Process

SmartWatch can process:

- Authentication information: your Gemini API key.
- User-provided content: the goal text you type into the extension and any custom prompt template you configure.
- Settings data: the Gemini model setting configured in Advanced settings.
- Web browsing activity: whether the active tab is a supported YouTube watch page, plus the URL and video ID of that current YouTube watch page.
- Website content: transcript text retrieved from YouTube captions or the YouTube page DOM for the current video.

## How Data Is Used

The extension uses this data only to:

- detect the current YouTube video,
- retrieve transcript text,
- send the transcript and your goal to the Gemini API,
- display the returned analysis in the side panel,
- save your local settings and last goal for convenience.

## Local Storage

The following values are stored locally in `chrome.storage.local`:

- Gemini API key
- selected Gemini model setting
- saved goal text
- custom prompt template

## Third-Party Processing

When you click `Analyze`, SmartWatch sends:

- your current goal text,
- the retrieved video transcript

to Google Gemini through the Generative Language API.

Your use of Gemini is also governed by [Google’s terms and privacy policies](https://policies.google.com/).

## Limited Use

The use of information received from Google APIs will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements.

SmartWatch uses data only to provide or improve its single purpose: analyzing the transcript of the current YouTube video against your stated goal. SmartWatch does not sell personal data, transfer data to advertising networks or data brokers, use data for personalized advertising, or use data to determine creditworthiness or lending eligibility.

## User Responsibility and Output Risk

- You are responsible for the prompts, goals, API key, custom templates, model settings, and any other input sent through the extension.
- You are responsible for reviewing and using the model output.
- Model output may be inaccurate, incomplete, biased, or misleading.
- The developer does not control or pre-review Gemini responses to user prompts.
- Do not submit secrets, confidential business data, or sensitive personal information unless you accept the risk of sending that content to Gemini.
- This tool is not legal, medical, financial, compliance, or other professional advice, and it should not be used as the sole basis for high-stakes or safety-critical decisions.
- You are responsible for ensuring that your use of YouTube content, transcripts, and generated outputs complies with applicable laws, platform terms, and any relevant rights or permissions.
- By using SmartWatch, you confirm that you are old enough to use Chrome, YouTube, Google Gemini or Google AI Studio, and Chrome Web Store extensions in your jurisdiction.

## What We Do Not Do

This project does not include a custom backend server.

The extension does not:

- sell personal data,
- share data with advertising networks,
- sync your settings to a project-owned cloud service,
- intentionally collect browsing history outside supported YouTube pages.

## Permissions

SmartWatch requests these Chrome permissions:

- `activeTab`: reads the active tab context so SmartWatch can confirm the current page is a YouTube watch page.
- `storage`: stores your Gemini API key, selected model, saved goal, and custom prompt template locally in Chrome extension storage.
- `scripting`: injects the content script when needed so transcript extraction can run on the current YouTube watch page.
- `sidePanel`: displays the SmartWatch user interface in Chrome's side panel.
- `webNavigation`: keeps side panel availability synchronized as YouTube changes videos through in-page navigation.
- `https://www.youtube.com/*` and `https://m.youtube.com/*`: limits transcript detection and extraction to YouTube pages.

## Retention

Locally stored values remain on the device until you change them, remove the extension, or clear extension storage.

## Support

For support, questions, or policy/contact context, use the developer profile at [linkedin.com/in/piotr-obiegly](https://www.linkedin.com/in/piotr-obiegly).

## Repository Scope

This file documents the current data handling behavior of the code in this repository.
