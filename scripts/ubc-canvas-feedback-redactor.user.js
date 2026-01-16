// ==UserScript==
// @name         UBC Canvas Recent Feedback Redactor
// @namespace    https://github.com/kel-z/
// @version      1.0
// @description  Redacts Recent Feedback scores on UBC Canvas until hovered
// @author       kel-z
// @match        https://canvas.ubc.ca/courses/*
// @grant        none
// @run-at       document-start
// @downloadURL  https://raw.githubusercontent.com/kel-z/tampermonkey-scripts/main/scripts/ubc-canvas-feedback-redactor.user.js
// @updateURL     https://raw.githubusercontent.com/kel-z/tampermonkey-scripts/main/scripts/ubc-canvas-feedback-redactor.user.js
// ==/UserScript==

(function() {
    'use strict';

    const FADE_IN_TIME_IN_SECONDS = 5;
    const FADE_OUT_TIME_IN_SECONDS = 0;

    const redactionStyles = `
        <style id="recent-feedback-redactor-styles">
            /* Hide all score elements by default */
            .event-details p strong {
                color: transparent !important;
                background: #000 !important;
                border-radius: 2px !important;
                padding: 2px 4px !important;
                display: inline-block !important;
                min-width: 60px !important;
                text-align: center !important;
                position: relative !important;
                transition: all ${FADE_OUT_TIME_IN_SECONDS}s ease !important;
            }

            /* Only redacted elements should be affected */
            .recent-feedback-redacted .event-details p strong {
                color: transparent !important;
                background: #000 !important;
            }

            .recent-feedback-redacted {
                position: relative;
                cursor: pointer;
            }

            .recent-feedback-redacted:hover .event-details p strong,
            .recent-feedback-redacted.hovering .event-details p strong {
                color: inherit !important;
                background: transparent !important;
                transition: all ${FADE_IN_TIME_IN_SECONDS}s ease !important;
            }

            .recent-feedback-redacted:hover::after {
                content: '';
                position: absolute;
                top: -2px;
                left: -2px;
                right: -2px;
                bottom: -2px;
                background: rgba(59, 130, 246, 0.1);
                border: 1px solid rgba(59, 130, 246, 0.3);
                border-radius: 4px;
                pointer-events: none;
                z-index: 1;
            }
        </style>
    `;

    function injectStylesImmediately() {
        if (!document.getElementById('recent-feedback-redactor-styles')) {
            const target = document.head || document.documentElement;
            target.insertAdjacentHTML('beforeend', redactionStyles);
        }
    }
    injectStylesImmediately();

    const originalContent = new Map();
    function redactFeedbackItem(feedbackItem) {
        if (!feedbackItem || feedbackItem.dataset.redacted === 'true') {
            return;
        }

        const scoreElement = feedbackItem.querySelector('.event-details p strong');
        if (!scoreElement) {
            return;
        }

        originalContent.set(feedbackItem, scoreElement.textContent);

        // add redacted class
        feedbackItem.classList.add('recent-feedback-redacted');
        feedbackItem.dataset.redacted = 'true';

        // add hover event listeners
        feedbackItem.addEventListener('mouseenter', handleHover);
        feedbackItem.addEventListener('mouseleave', handleHoverLeave);
    }
    function handleHover(e) {
        e.currentTarget.classList.add('hovering');
    }
    function handleHoverLeave(e) {
        e.currentTarget.classList.remove('hovering');
    }

    // redact all recent feedback items
    function redactAllFeedback() {
        const recentFeedbackContainer = document.querySelector('.events_list.recent_feedback');
        if (!recentFeedbackContainer) {
            return;
        }

        const feedbackItems = recentFeedbackContainer.querySelectorAll('.event');
        feedbackItems.forEach(redactFeedbackItem);
    }

    // not sure if this is needed but including anyways
    function setupMutationObserver() {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    // check new node
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.classList && node.classList.contains('event')) {
                            redactFeedbackItem(node);
                        }

                        // check if feedback item
                        const feedbackItems = node.querySelectorAll ?
                            node.querySelectorAll('.event') : [];
                        feedbackItems.forEach(redactFeedbackItem);
                    }
                });
            });
        });

        observer.observe(document.body || document.documentElement, {
            childList: true,
            subtree: true
        });

        return observer;
    }

    function initialize() {
        redactAllFeedback();
        setupMutationObserver();
    }

    initialize();
})();
