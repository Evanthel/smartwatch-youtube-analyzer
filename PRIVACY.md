# Privacy Note for SmartWatch

## Summary

SmartWatch analyzes YouTube video transcripts against a goal you enter in the extension UI.

## Data We Process

SmartWatch can process:

- your Gemini API key,
- the Gemini model setting configured in Advanced settings,
- the goal text you type into the extension,
- the URL and video ID of the active YouTube watch page,
- transcript text retrieved from YouTube captions or the YouTube page DOM.

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

## User Responsibility and Output Risk

- You are responsible for the prompts, goals, API key, custom templates, model settings, and any other input sent through the extension.
- You are responsible for reviewing and using the model output.
- Model output may be inaccurate, incomplete, biased, or misleading.
- The project author does not take accountability for generated content, decisions made from it, or downstream use of the response.
- Do not submit secrets, confidential business data, or sensitive personal information unless you accept the risk of sending that content to Gemini.
- This tool is not legal, medical, financial, compliance, or other professional advice, and it should not be used as the sole basis for high-stakes or safety-critical decisions.
- You are responsible for ensuring that your use of YouTube content, transcripts, and generated outputs complies with applicable laws, platform terms, and any relevant rights or permissions.

## What We Do Not Do

This project does not include a custom backend server.

The extension does not:

- sell personal data,
- share data with advertising networks,
- sync your settings to a project-owned cloud service,
- intentionally collect browsing history outside supported YouTube pages.

## Permissions

SmartWatch requests these Chrome permissions:

- `activeTab` to access the current tab context
- `storage` to save settings locally
- `scripting` to run transcript extraction fallback logic in the current tab
- `sidePanel` to display the extension UI
- `webNavigation` to keep side panel availability synchronized with tab navigation

## Retention

Locally stored values remain on the device until you change them, remove the extension, or clear extension storage.

## Repository Scope

This file documents the current data handling behavior of the code in this repository.
