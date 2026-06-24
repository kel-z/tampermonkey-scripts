# tampermonkey-scripts

kel-z tampermonkey scripts

## scripts

### ubc-canvas-feedback-redactor.user.js

automatically redact scores displayed in the "recent feedback" section on ubc canvas course pages to prevent jumpscares.
scores are only revealed when you hover over them.

modify these variables in the source code to adjust fade timing:

- `FADE_IN_TIME_IN_SECONDS` (default: 5) - how quickly scores appear on hover
- `FADE_OUT_TIME_IN_SECONDS` (default: 0) - how quickly scores disappear when unhovered

### messenger-view-as.user.js

adds a "view as" dropdown to messenger.com chats that visually re-skins messages
to reframe chats in a different perspective.

- **off** - normal view
- **everyone (all received)** - your messages flip to grey/left with your profile
  picture, so the whole chat looks like incoming messages
- **a chat member** - additionally promotes that person's messages to blue/right
  with no avatar, as if viewing from their perspective

the dropdown auto-populates with people who have sent messages in the currently-visible chat.
