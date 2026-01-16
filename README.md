# tampermonkey-scripts

kel-z tampermonkey scripts

## scripts

### ubc-canvas-feedback-redactor.user.js

automatically redact scores displayed in the "recent feedback" section on ubc canvas course pages to prevent jumpscares.
scores are only revealed when you hover over them.

modify these variables in the source code to adjust fade timing:

- `FADE_IN_TIME_IN_SECONDS` (default: 5) - how quickly scores appear on hover
- `FADE_OUT_TIME_IN_SECONDS` (default: 0) - how quickly scores disappear when unhovered
