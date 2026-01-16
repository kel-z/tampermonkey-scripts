# Tampermonkey Scripts

A collection of Tampermonkey userscripts.

## Scripts

### ubc-canvas-feedback-redactor.user.js

Automatically redact scores displayed in the "Recent Feedback" section on UBC Canvas course pages to prevent jumpscares.
Scores are only revealed when you hover over them.

The script includes customizable fade timing. Modify these variables in the source code:

- `FADE_IN_TIME_IN_SECONDS` (default: 5) - How quickly scores appear on hover
- `FADE_OUT_TIME_IN_SECONDS` (default: 0) - How quickly scores disappear when unhovered
