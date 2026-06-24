// ==UserScript==
// @name         Messenger View As
// @namespace    https://github.com/kel-z/
// @version      1.1
// @description  Add a "View as" dropdown to Messenger that visually flips a chat to another person's perspective
// @author       kel-z
// @match        https://www.messenger.com/*
// @match        https://messenger.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/kel-z/tampermonkey-scripts/main/scripts/messenger-view-as.user.js
// @updateURL    https://raw.githubusercontent.com/kel-z/tampermonkey-scripts/main/scripts/messenger-view-as.user.js
// ==/UserScript==

(function () {
    'use strict';

    // ---------------------------------------------------------------------
    // Messenger DOM hooks (the only site-specific selectors; confirmed
    // against a saved messenger.com group-chat DOM). If Meta restructures
    // the page, this is the block to re-tune.
    //   - Each message:      div[aria-roledescription="message"], whose
    //                        aria-label is "At <time>, <Sender>: <text>"
    //                        (sender is "You" for your own messages).
    //   - Message list root: div[role="log"][aria-label^="Messages in conversation"]
    //   - Sender avatars:    img[alt="<Full Name>"] (first name matches sender)
    //   - Your avatar:       <image> inside [aria-label$="Settings, help and more"]
    // Bubble colour/alignment use obfuscated, churning classes, so we never
    // match on those — we detect/override them at runtime via computed style.
    // ---------------------------------------------------------------------
    const SEL = {
        message: '[aria-roledescription="message"]',
        log: '[role="log"][aria-label^="Messages in conversation"]',
        accountBtn: '[aria-label$="Settings, help and more"]',
    };

    const OFF = '__off__';
    const EVERYONE = '__everyone__';

    const SILHOUETTE =
        'data:image/svg+xml;utf8,' +
        encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36">' +
            '<circle cx="18" cy="18" r="18" fill="#555"/>' +
            '<circle cx="18" cy="14" r="6" fill="#aaa"/>' +
            '<path d="M6 32c0-6 5-10 12-10s12 4 12 10z" fill="#aaa"/></svg>'
        );

    // Per-thread remembered selection; resets to OFF for new threads.
    const threadSelections = {};
    let currentThread = null;
    let currentMode = OFF;
    let sig = 0;            // bumped on mode/thread change to force reprocessing
    let forceRefresh = false; // one-shot: rebuild injected avatars/labels next pass
    let myAvatarUrl = null;
    let sampleCache = null; // cached pristine blue/grey bubble colours (per thread)
    let labelStyleCache = null; // cached native sender-label {color,size} (per thread)
    let knownMembers = [];  // first names seen as senders (excluding "You")

    // Display name above my runs. Prefer GM storage (survives the page clearing
    // localStorage); fall back to localStorage — which also migrates a name saved
    // by the pre-GM version and covers GM read/write failures. Blank = no label.
    const NAME_KEY = 'mva-my-name';
    const DEFAULT_NAME = 'You';
    const hasGM = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';
    function loadName() {
        try { if (hasGM) { const v = GM_getValue(NAME_KEY, null); if (v !== null) return v; } } catch (e) {}
        try { const v = localStorage.getItem(NAME_KEY); if (v !== null) return v; } catch (e) {}
        return DEFAULT_NAME;
    }
    function saveName(v) {
        try { if (hasGM) { GM_setValue(NAME_KEY, v); return; } } catch (e) {}
        try { localStorage.setItem(NAME_KEY, v); } catch (e) {}
    }
    let myDisplayName = loadName();

    // ----------------------------- styles --------------------------------
    function injectStyles() {
        if (document.getElementById('mva-styles')) return;
        const css = `
            /* Use Messenger's design tokens so the bar blends in and tracks light/dark. */
            #mva-bar {
                position: fixed; top: 10px; left: 50%; transform: translateX(-50%);
                z-index: 2147483647; display: flex; align-items: center; gap: 10px;
                background: var(--card-background, var(--surface-background, var(--comment-background, #242526)));
                color: var(--primary-text, #e4e6eb);
                border: 1px solid var(--divider, rgba(128,128,128,.25));
                padding: 5px 8px 5px 14px; border-radius: 20px;
                font: 600 13px/1.2 system-ui, -apple-system, sans-serif;
                box-shadow: var(--shadow-2, 0 2px 8px rgba(0,0,0,.2));
                user-select: none;
            }
            #mva-bar label { color: var(--secondary-text, #b0b3b8); }
            #mva-bar select {
                background: var(--secondary-button-background, var(--comment-background, var(--wash, rgba(128,128,128,.15))));
                color: var(--primary-text, #e4e6eb);
                border: 1px solid var(--divider, rgba(128,128,128,.25));
                border-radius: 16px; padding: 5px 8px; font: inherit; font-weight: 500;
                max-width: 220px; cursor: pointer;
            }
            #mva-bar.mva-active { border-color: var(--accent, #0a84ff); }
            #mva-bar.mva-active label { color: var(--accent, #0a84ff); }
            #mva-gear {
                appearance: none; -webkit-appearance: none; outline: none;
                background: transparent; border: none; cursor: pointer; padding: 2px;
                color: var(--secondary-text, #b0b3b8); line-height: 0;
                display: flex; align-items: center;
            }
            #mva-gear:hover { color: var(--primary-text, #e4e6eb); }
            #mva-pop {
                display: none; position: absolute; top: 100%; right: 0; margin-top: 8px;
                background: var(--card-background, var(--surface-background, var(--comment-background, #242526)));
                color: var(--primary-text, #e4e6eb);
                border: 1px solid var(--divider, rgba(128,128,128,.25)); border-radius: 12px;
                padding: 10px 12px; box-shadow: var(--shadow-5, 0 8px 24px rgba(0,0,0,.4)); white-space: nowrap;
            }
            #mva-pop.mva-open { display: block; }
            #mva-pop label { display: flex; flex-direction: column; gap: 6px; color: var(--secondary-text, #b0b3b8); }
            #mva-pop input {
                background: var(--secondary-button-background, var(--comment-background, rgba(128,128,128,.15)));
                color: var(--primary-text, #e4e6eb);
                border: 1px solid var(--divider, rgba(128,128,128,.25)); border-radius: 8px;
                padding: 5px 8px; font: inherit; width: 160px;
            }
            #mva-pop input:focus { border-color: var(--accent, #0a84ff); outline: none; }
            .mva-avatar {
                position: absolute; left: 14px; bottom: 6px; width: 28px; height: 28px;
                border-radius: 50%; object-fit: cover; z-index: 5; pointer-events: none;
            }
            .mva-hide { display: none !important; }
            .mva-namehide { display: none !important; }
            /* Injected sender label above my runs, matching Messenger's native ones. */
            .mva-myname {
                position: absolute; top: 2px; left: 62px; direction: ltr;
                font: 400 12px/14px -apple-system, system-ui, sans-serif;
                color: var(--secondary-text, rgb(176, 179, 184)); pointer-events: none; z-index: 5;
            }
            .mva-collapse { width: 0 !important; min-width: 0 !important; max-width: 0 !important; margin: 0 !important; padding: 0 !important; overflow: hidden !important; }
            /* Force --mva-text onto a re-skinned bubble, overriding the theme's span colours. */
            .mva-recolored, .mva-recolored * { color: var(--mva-text) !important; }
            /* Hide the "Sent / Delivered …" status label — it doesn't belong on
               a message we're disguising as received. */
            .mva-status { display: none !important; }
            /* When active, kill the theme's shared gradient backdrop (and any
               other CSS gradient/background-image) inside the message list, so
               it can't leak as big coloured blocks behind re-skinned bubbles.
               Real photos/stickers/avatars are <img>/<image>, so unaffected. */
            body.mva-on ${SEL.log} *:not(img):not(image) {
                background-image: none !important;
            }
        `;
        const style = document.createElement('style');
        style.id = 'mva-styles';
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
    }

    // ----------------------------- helpers -------------------------------
    function parseRGB(str) {
        const m = str && str.match(/rgba?\(([^)]+)\)/);
        if (!m) return null;
        const p = m[1].split(',').map(x => parseFloat(x));
        return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
    }
    // Parse aria-label -> { sender, mine }. The sender follows the time's AM/PM,
    // so anchor on that (the date in older labels adds commas that would confuse
    // a plain split). Format:
    //   "At <time>, <Sender>: <message>"
    //   "At <month day, year>, <time>, <Sender>: <message>"  (date adds commas)
    function parseMsg(el) {
        const lab = el.getAttribute('aria-label') || '';
        // Anchor on the time's am/pm (case-insensitive: "9:11 PM" or "6:04pm").
        let m = lab.match(/[ap]m,\s+([^:]+?)(?::|$)/i);
        if (!m) m = lab.match(/^At\s[^,]+,\s+([^:]+?)(?::|$)/);   // 24h fallback
        const sender = m ? m[1].trim() : '';
        return { sender, mine: sender === 'You' };
    }

    function firstName(s) { return (s || '').trim().split(/\s+/)[0]; }

    // Add a member to the dropdown, deduped by first name (matching collapses by
    // first name too, so a bare first name and its fuller "First Last" form are
    // the same option). Keeps the shortest form seen. Returns true if it changed.
    function addMember(sender) {
        if (!sender) return false;
        const fn = firstName(sender);
        const i = knownMembers.findIndex(m => firstName(m) === fn);
        if (i === -1) { knownMembers.push(sender); return true; }
        if (sender.length < knownMembers[i].length) { knownMembers[i] = sender; return true; }
        return false;
    }

    // The message text, taken from the aria-label ("…Sender: <text>").
    // Returns null for non-text messages (images/stickers have no ": text").
    function getMsgText(msg) {
        const lab = msg.getAttribute('aria-label') || '';
        const i = lab.indexOf(': ');
        return i < 0 ? null : lab.slice(i + 2).trim();
    }

    const norm = s => (s || '').replace(/\s+/g, ' ').trim();

    // Locate a text message's bubble. `div.x14ctfv` is Messenger's stable bubble
    // wrapper (works even when the bubble background is transparent in custom /
    // gradient themes). We anchor on the message text first so the right bubble
    // is picked even if a message somehow had several, then fall back to the
    // message's own bubble wrapper (handles emoji-only text the aria-label
    // doesn't echo). Returns null for non-text messages (images/stickers).
    function findBubble(msg) {
        const want = norm(getMsgText(msg));
        if (!want) return null;                 // non-text message: don't recolour
        let textEl = null;
        const cands = msg.querySelectorAll('div[dir="auto"], span[dir="auto"]');
        for (const el of cands) {               // tightest element equal to the text
            if (norm(el.textContent) === want && (!textEl || textEl.contains(el))) textEl = el;
        }
        if (!textEl) {                          // deepest element containing it
            for (const el of cands) {
                if (norm(el.textContent).includes(want) && (!textEl || textEl.contains(el))) textEl = el;
            }
        }
        let bubble = null, bgFallback = null;
        if (textEl) {
            let el = textEl;
            while (el && el !== msg) {
                if (el.tagName === 'DIV' && el.classList.contains('x14ctfv')) { bubble = el; break; }
                if (!bgFallback) {
                    const c = parseRGB(getComputedStyle(el).backgroundColor);
                    if (c && c.a > 0.1) bgFallback = el;
                }
                el = el.parentElement;
            }
        }
        return bubble || bgFallback || msg.querySelector('div.x14ctfv');
    }

    function getContainer() { return document.querySelector(SEL.log); }

    function getThreadId() {
        const m = location.pathname.match(/\/t\/([^/]+)/);
        return m ? m[1] : location.pathname;
    }

    function getMyAvatarUrl() {
        if (myAvatarUrl) return myAvatarUrl;
        const btn = document.querySelector(SEL.accountBtn);
        let url = '';
        if (btn) {
            const im = btn.querySelector('image');
            if (im) url = im.getAttribute('xlink:href') || im.getAttribute('href') || '';
            if (!url) { const img = btn.querySelector('img'); if (img) url = img.src; }
        }
        myAvatarUrl = url || SILHOUETTE;
        return myAvatarUrl;
    }

    function fallbackSamples() {
        const dark = (parseRGB(getComputedStyle(document.body).backgroundColor) || { r: 0 }).r < 128;
        return dark
            ? { blueBg: 'rgb(0,132,255)', blueText: 'rgb(255,255,255)', greyBg: 'rgb(53,54,58)', greyText: 'rgb(228,230,235)' }
            : { blueBg: 'rgb(0,132,255)', blueText: 'rgb(255,255,255)', greyBg: 'rgb(233,233,235)', greyText: 'rgb(5,5,5)' };
    }

    // Sample the chat's real solid blue/grey bubble colours so recolouring
    // matches the theme. Caveats handled here:
    //  - only sample PRISTINE bubbles (skip ones we've recoloured), and
    //  - skip GRADIENT bubbles (a gradient theme has no single solid colour to
    //    copy; reading its base colour gives grey, which made *everything* grey).
    //    Use the fallback for that side instead.
    // MUST be called BEFORE neutralizeTheme(), while gradients are still intact,
    // and the fully-resolved result is cached so a later pass (gradient already
    // stripped) can't re-contaminate it.
    function computeSamples(msgs) {
        if (sampleCache) return sampleCache;
        const fb = fallbackSamples();
        let blueBg, blueText, greyBg, greyText;
        for (const msg of msgs) {
            const b = findBubble(msg);
            if (!b || b.classList.contains('mva-touched')) continue;       // skip our own recolours
            const cs = getComputedStyle(b);
            if (cs.backgroundImage && cs.backgroundImage.indexOf('gradient') !== -1) continue;  // gradient => fallback
            const c = parseRGB(cs.backgroundColor);
            if (!c || c.a < 0.1) continue;                                  // transparent
            // Read the TEXT colour from the LEAF that actually holds the message
            // text — the bubble wrapper (and its first dir="auto") often report
            // white even when the visible text is dark (e.g. a green sent bubble).
            let txt = cs.color;
            const wantText = norm(getMsgText(msg) || '');
            if (wantText) {
                let best = null;
                b.querySelectorAll('*').forEach(e => {
                    if (e.children.length === 0 && norm(e.textContent) && wantText.indexOf(norm(e.textContent)) !== -1) {
                        if (!best || e.textContent.length > best.textContent.length) best = e;
                    }
                });
                if (best) txt = getComputedStyle(best).color;
            }
            const { mine } = parseMsg(msg);
            if (mine && !blueBg) { blueBg = cs.backgroundColor; blueText = txt; }
            if (!mine && !greyBg) { greyBg = cs.backgroundColor; greyText = txt; }
            if (blueBg && greyBg) break;
        }
        const resolved = {
            blueBg: blueBg || fb.blueBg, blueText: blueText || fb.blueText,
            greyBg: greyBg || fb.greyBg, greyText: greyText || fb.greyText,
        };
        if (blueBg || greyBg) sampleCache = resolved;   // cache once we have a real sample
        return resolved;
    }

    // Custom/gradient themes paint a shared gradient backdrop behind the whole
    // conversation (an element OUTSIDE the message log); once we re-skin/move
    // bubbles it stops being masked and leaks as big coloured blocks. Walk up
    // from the log and strip any gradient background on ancestors/their direct
    // children. Keying on "gradient" preserves image wallpapers (url(...)).
    function killGradients() {
        const container = getContainer();
        if (!container) return;
        let node = container;
        for (let i = 0; i < 12 && node; i++, node = node.parentElement) {
            for (const el of [node, ...node.children]) {
                if (el.classList.contains('mva-gradkill')) continue;
                const bi = getComputedStyle(el).backgroundImage;
                if (bi && bi.indexOf('gradient') !== -1) {
                    el.classList.add('mva-gradkill');
                    // SAVE the original inline value first — if the gradient was
                    // set inline, a plain removeProperty on restore would delete
                    // it for good (transparent message until reload).
                    el.dataset.mvaBg = el.style.getPropertyValue('background-image');
                    el.dataset.mvaBgPri = el.style.getPropertyPriority('background-image');
                    el.style.setProperty('background-image', 'none', 'important');
                }
            }
        }
    }

    // The `mva-on` body class also strips gradients *inside* the log via CSS.
    function neutralizeTheme() {
        document.body.classList.add('mva-on');
        killGradients();
    }
    function restoreTheme() {
        document.body.classList.remove('mva-on');
        document.querySelectorAll('.mva-gradkill').forEach(el => {
            const orig = el.dataset.mvaBg;
            if (orig) el.style.setProperty('background-image', orig, el.dataset.mvaBgPri || '');
            else el.style.removeProperty('background-image');   // was from a class, not inline
            delete el.dataset.mvaBg;
            delete el.dataset.mvaBgPri;
            el.classList.remove('mva-gradkill');
        });
    }

    // ----------------------------- restyle -------------------------------
    // Tag with BOTH a class and a `--mva` custom property: Messenger re-renders
    // nodes and resets className (dropping `mva-touched`) while keeping the inline
    // styles we added, so cleanup keys on `--mva` to find them even then.
    function mark(el) {
        el.classList.add('mva-touched');
        el.style.setProperty('--mva', '1');
    }

    function ensureRelative(el) {
        if (getComputedStyle(el).position === 'static') el.style.setProperty('position', 'relative');
    }

    function recolor(bubble, bg, text) {
        if (!bubble || !bg) return;
        mark(bubble);
        // Set background-COLOR (not the `background` shorthand) so we don't reset
        // background-clip/-origin, which some themes use to render the bubble's
        // rounded/grouped shape. Kill the gradient image separately.
        bubble.style.setProperty('background-color', bg, 'important');
        bubble.style.setProperty('background-image', 'none', 'important');
        // Prefer the theme's real text colour for that bubble kind; fall back to
        // a luminance-based choice only when no sample was available.
        if (!text) {
            const c = parseRGB(bg);
            const lum = c ? 0.299 * c.r + 0.587 * c.g + 0.114 * c.b : 0;
            text = lum < 140 ? '#ffffff' : '#050505';
        }
        bubble.style.setProperty('--mva-text', text);
        bubble.classList.add('mva-recolored');
    }

    // Flip the whole message to the opposite side. `direction: rtl` mirrors the
    // received↔sent layout as a unit, so the bubble hugs the correct edge (a
    // plain alignment can't — a received message's content column lives on the
    // left and can't reach the right edge). The few things rtl over-mirrors
    // (read-receipts) are put back by counterFlipReceipts(). Text keeps its own
    // dir="auto", so it still reads left-to-right.
    function setFlip(msg) {
        mark(msg);
        msg.style.setProperty('direction', 'rtl', 'important');
    }

    // The wrapper a few levels above a "seen by" read-receipt avatar.
    function receiptBox(img, msg) {
        let box = img;
        for (let i = 0; i < 4 && box && box !== msg; i++) box = box.parentElement;
        return (!box || box === msg) ? img.parentElement : box;
    }

    // rtl mirrors the read-receipt avatars to the wrong side; pin the cluster back
    // to the right with an ltr island + auto left margin. (Used on the view-as
    // person's sent-looking messages, where a read receipt still makes sense.)
    function counterFlipReceipts(msg) {
        msg.querySelectorAll('img[alt^="Seen by"]').forEach(img => {
            const box = receiptBox(img, msg);
            mark(box);
            box.style.setProperty('direction', 'ltr', 'important');
            box.style.setProperty('margin-left', 'auto', 'important');
            box.style.setProperty('align-self', 'flex-start', 'important');  // rtl: flex-start = right
        });
    }

    // On MY received-looking messages a "seen by" receipt is incongruous and its
    // height pushes the injected avatar off-centre — hide it instead.
    function hideReceipts(msg) {
        msg.querySelectorAll('img[alt^="Seen by"]').forEach(img => {
            const box = receiptBox(img, msg);
            mark(box);
            box.style.setProperty('display', 'none', 'important');
        });
    }

    // A text message whose bubble couldn't be located yet (still rendering during
    // a fast scroll) is INCOMPLETE — we must retry, not mark it done, or it gets
    // stranded uncoloured (grey). Image/sticker messages have no bubble and are
    // complete once aligned.
    function isComplete(msg, bubble) { return !!bubble || !getMsgText(msg); }

    // Turn one of MY messages into a received-looking one (grey, left).
    function styleAsReceived(msg, s) {
        const bubble = findBubble(msg);
        if (bubble) recolor(bubble, s.greyBg, s.greyText);
        setFlip(msg);
        msg.style.setProperty('padding-left', '44px', 'important');  // gutter for my avatar
        hideReceipts(msg);
        return isComplete(msg, bubble);
    }

    // Turn the view-as person's message into a sent-looking one (blue, right).
    function styleAsSent(msg, s) {
        const bubble = findBubble(msg);
        if (bubble) recolor(bubble, s.blueBg, s.blueText);
        setFlip(msg);
        // They're "sending" now, so hide the sender-name label above their run
        // (you don't see your own name over your own messages).
        const sender = parseMsg(msg).sender;
        const label = [...msg.querySelectorAll('span[dir="auto"]')]
            .find(s2 => s2.textContent.trim() === sender && !s2.closest('.x14ctfv'));
        if (label) { mark(label); label.classList.add('mva-namehide'); }
        collapseAvatarGutter(msg);
        counterFlipReceipts(msg);
        return isComplete(msg, bubble);
    }

    // Collapse the empty avatar column on a sent-disguised message — Messenger
    // reserves a narrow (~28-50px) spacer even when no avatar is drawn. Mid-run
    // spacers are only one-line tall, so the height floor must stay low.
    function collapseAvatarGutter(msg) {
        for (const el of msg.querySelectorAll('div, span')) {
            const r = el.getBoundingClientRect();
            if (r.width < 16 || r.width > 56 || r.height < 14) continue;
            if (el.textContent.trim()) continue;                 // skip bubble/text
            if (el.getAttribute('role') === 'toolbar' || el.querySelector('[role="toolbar"]')) continue;
            mark(el); el.classList.add('mva-collapse');
        }
    }

    // Strip every inline property + marker class we set on one element.
    function clearTouched(el) {
        for (const p of ['--mva', 'background-color', 'background-image', '--mva-text',
                         'direction', 'align-self', 'margin-left', 'padding-left',
                         'padding-top', 'position', 'display']) {
            el.style.removeProperty(p);
        }
        el.classList.remove('mva-touched', 'mva-recolored', 'mva-namehide', 'mva-collapse');
    }

    // Remove injected nodes + per-message markers from a scope (used by both the
    // per-message revert and the full reset).
    function clearInjected(scope) {
        scope.querySelectorAll('.mva-avatar, .mva-myname').forEach(a => a.remove());
        scope.querySelectorAll('.mva-mypad').forEach(a => { a.style.removeProperty('padding-top'); a.classList.remove('mva-mypad'); });
        scope.querySelectorAll('.mva-hide').forEach(a => a.classList.remove('mva-hide'));
        scope.querySelectorAll('.mva-status').forEach(a => a.classList.remove('mva-status'));
    }

    function revertNode(msg) {
        clearTouched(msg);                                        // idempotent
        msg.querySelectorAll('[style*="--mva"]').forEach(clearTouched);
        clearInjected(msg);
        delete msg.dataset.mvaKey;
    }

    // Toggle-off / mode-switch full cleanup. Sweep by `--mva`, not by class, so a
    // recycled node whose className was reset still gets cleaned (see mark()).
    function resetAll(container) {
        const c = container || getContainer();
        if (!c) return;
        clearInjected(c);
        c.querySelectorAll('[style*="--mva"]').forEach(clearTouched);
        c.querySelectorAll('[data-mva-key]').forEach(m => delete m.dataset.mvaKey);
        restoreTheme();
    }

    // -------------------------- main apply -------------------------------
    function applyMode() {
        const container = getContainer();
        if (!container) return;   // keep forceRefresh pending until the log exists
        // Consume the one-shot here, before any early return, so it can't leak
        // into a later pass (e.g. if the name is edited while mode is OFF).
        const refresh = forceRefresh; forceRefresh = false;
        const bar = document.getElementById('mva-bar');
        if (bar) bar.classList.toggle('mva-active', currentMode !== OFF);

        const msgs = [...container.querySelectorAll(SEL.message)];
        const parsed = msgs.map(parseMsg);   // parse each aria-label once per pass

        // Keep the member dropdown current.
        let membersChanged = false;
        for (const p of parsed) {
            if (!p.mine && addMember(p.sender)) membersChanged = true;
        }
        if (membersChanged) rebuildOptions();

        if (currentMode === OFF) { resetAll(container); return; }

        const s = computeSamples(msgs);   // sample colours BEFORE killing gradients
        neutralizeTheme();
        const person = (currentMode === EVERYONE) ? null : currentMode;

        let processedAny = false;
        for (let i = 0; i < msgs.length; i++) {
            const msg = msgs[i];
            // Key on both the mode counter AND the message's aria-label: Messenger
            // virtualises the list and recycles a node for a different message as
            // you scroll, so a counter alone would leave stale styling behind.
            const key = sig + '|' + (msg.getAttribute('aria-label') || '');
            if (msg.dataset.mvaKey === key) continue;
            revertNode(msg);
            const { sender, mine } = parsed[i];
            let complete = true;
            if (mine) {
                complete = styleAsReceived(msg, s);
            } else if (person && firstName(sender) === firstName(person)) {
                complete = styleAsSent(msg, s);
            }
            // Only mark done once fully styled (see isComplete); a not-yet-rendered
            // bubble is retried next pass instead of being left uncoloured.
            if (complete) msg.dataset.mvaKey = key;
            processedAny = true;
        }

        // Avatars/labels are rebuilt whenever the message set changed (run
        // boundaries shift) or a setting changed (`refresh`, e.g. the name).
        if (processedAny || refresh) refreshAvatars(container, msgs, parsed, person);
    }

    function refreshAvatars(container, msgs, parsed, person) {
        clearInjected(container);   // remove the previous pass's injected layer

        // Hide "Sent / Delivered …" status labels — only ever on my messages, so
        // scan just those subtrees rather than every node in the thread.
        for (let i = 0; i < msgs.length; i++) {
            if (!parsed[i].mine) continue;
            msgs[i].querySelectorAll('span, div').forEach(el => {
                if (el.children.length === 0 && /^(Sent|Delivered)\b/.test(el.textContent.trim())) {
                    el.classList.add('mva-status');
                }
            });
        }

        // Sample a native sender-label's colour/size once per thread (varies by
        // theme). Read the deepest text leaf — the wrapper span can report grey
        // while the real colour sits on an inner span. Hidden/flipped labels are
        // fine; their computed colour is still correct.
        if (!labelStyleCache) {
            const lbl = [...container.querySelectorAll('span[dir="auto"]')].find(el => {
                const t = el.textContent.trim();
                return t && el.closest('[aria-roledescription="message"]') &&   // not the pinned-banner author
                    knownMembers.some(k => firstName(k) === firstName(t)) && !el.closest('.x14ctfv');
            });
            if (lbl) {
                const leaf = [...lbl.querySelectorAll('*')].filter(e => e.children.length === 0 && e.textContent.trim()).pop() || lbl;
                const cs = getComputedStyle(leaf);
                labelStyleCache = { color: cs.color, size: cs.fontSize };
            }
        }

        // Inject my avatar at the bottom of each of my runs and a "You" label at
        // the top — mirroring how the others' avatars/names frame their runs.
        const url = getMyAvatarUrl();
        for (let i = 0; i < msgs.length; i++) {
            if (!parsed[i].mine) continue;
            const firstOfRun = i === 0 || !parsed[i - 1].mine;
            const lastOfRun = i === msgs.length - 1 || !parsed[i + 1].mine;
            if (!firstOfRun && !lastOfRun) continue;
            ensureRelative(msgs[i]);
            if (lastOfRun) {
                const img = document.createElement('img');
                img.className = 'mva-avatar';
                img.src = url;
                msgs[i].appendChild(img);
            }
            if (firstOfRun && myDisplayName) {   // blank name => no label, no top gap
                const name = document.createElement('div');
                name.className = 'mva-myname';
                name.textContent = myDisplayName;
                if (labelStyleCache) { name.style.color = labelStyleCache.color; name.style.fontSize = labelStyleCache.size; }
                msgs[i].style.setProperty('padding-top', '18px', 'important');  // room for the label
                msgs[i].classList.add('mva-mypad');
                msgs[i].appendChild(name);
            }
        }

        // Hide the view-as person's own avatars (they're "sending" now), so the
        // gutter collapses with no empty space where their picture used to be.
        if (person) {
            const fn = firstName(person);
            container.querySelectorAll('img[alt]').forEach(img => {
                const alt = img.getAttribute('alt') || '';
                if (alt.startsWith('Seen by')) return;        // read receipt, leave it
                if (firstName(alt) === fn) (img.closest('[role="button"]') || img).classList.add('mva-hide');
            });
        }
    }

    // ----------------------------- UI ------------------------------------
    function buildBar() {
        if (document.getElementById('mva-bar')) return;
        const bar = document.createElement('div');
        bar.id = 'mva-bar';
        bar.innerHTML = '<label>View as</label>';
        const sel = document.createElement('select');
        sel.id = 'mva-select';
        sel.addEventListener('change', () => {
            currentMode = sel.value;
            threadSelections[currentThread] = currentMode;
            sig++;
            resetAll();
            applyMode();
        });
        bar.appendChild(sel);
        buildSettings(bar);
        document.body.appendChild(bar);
        rebuildOptions();
    }

    // Gear button + popover that sets the display name shown above my messages.
    function buildSettings(bar) {
        const gear = document.createElement('button');
        gear.id = 'mva-gear';
        gear.type = 'button';
        gear.title = 'Settings';
        gear.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.14 12.94a7.5 7.5 0 0 0 .05-.94 7.5 7.5 0 0 0-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.62l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7 7 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.43h-3.84a.5.5 0 0 0-.5.43l-.36 2.54a7 7 0 0 0-1.62.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.86a.5.5 0 0 0 .12.62l2.03 1.58a7.5 7.5 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.62l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96a7 7 0 0 0 1.62.94l.36 2.54a.5.5 0 0 0 .5.43h3.84a.5.5 0 0 0 .5-.43l.36-2.54a7 7 0 0 0 1.62-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.62l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"/></svg>';
        bar.appendChild(gear);

        const pop = document.createElement('div');
        pop.id = 'mva-pop';
        pop.innerHTML = `<label>Your display name<input id="mva-name-input" type="text" placeholder="(blank)"
            autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"
            data-1p-ignore="true" data-lpignore="true" data-bwignore="true" data-form-type="other"></label>`;
        bar.appendChild(pop);

        const input = pop.querySelector('#mva-name-input');
        input.value = myDisplayName;
        gear.addEventListener('click', () => {
            pop.classList.toggle('mva-open');
            if (pop.classList.contains('mva-open')) input.focus();
        });
        input.addEventListener('input', () => {
            myDisplayName = input.value;
            saveName(myDisplayName);
            forceRefresh = true;         // rebuild only the labels, not every bubble
            applyMode();
        });
        document.addEventListener('click', e => { if (!bar.contains(e.target)) pop.classList.remove('mva-open'); });
    }

    function rebuildOptions() {
        const sel = document.getElementById('mva-select');
        if (!sel) return;
        const prev = currentMode;
        sel.innerHTML = '';
        const add = (val, text) => { const o = document.createElement('option'); o.value = val; o.textContent = text; sel.appendChild(o); };
        add(OFF, 'Yourself');
        add(EVERYONE, 'Nobody');
        for (const name of knownMembers) add(name, name);
        sel.value = prev;
        if (sel.value !== prev) { sel.value = OFF; currentMode = OFF; }  // selected member left/gone
    }

    // ------------------------- lifecycle ---------------------------------
    function handleThreadSwitch() {
        const t = getThreadId();
        if (t === currentThread) return false;
        const old = getContainer();
        if (old) resetAll(old);
        currentThread = t;
        currentMode = threadSelections[t] || OFF;
        knownMembers = [];
        sampleCache = null;     // colours/theme differ per thread
        labelStyleCache = null;
        sig++;
        rebuildOptions();
        return true;
    }

    let scheduled = false;
    function schedule() {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => { scheduled = false; try { applyMode(); } catch (e) { /* ignore transient DOM races */ } });
    }

    let observed = null;
    function tick() {
        injectStyles();
        const container = getContainer();
        if (!container) return;
        buildBar();
        handleThreadSwitch();
        if (observed !== container) {
            observed = container;
            const mo = new MutationObserver(schedule);
            mo.observe(container, { childList: true, subtree: true });
        }
        schedule();
    }

    // Poll to catch SPA navigation / log re-creation the observer can't see;
    // the observer handles in-thread message changes between ticks.
    setInterval(tick, 600);
    tick();
})();
