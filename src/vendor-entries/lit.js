/*
 * What the panel uses of lit-html, named here so the vendor bundle carries
 * exactly this and nothing silently more. unsafeHTML and unsafeSVG are
 * exported deliberately and each import site owes the reviewer an answer
 * (docs/10-house-style.md); today's two answers are message-stream (a
 * template shared with the string-rendered embed) and the phosphor icon
 * paths (machine-generated constants).
 */
export { html, nothing, render, svg } from 'lit-html';
export { live } from 'lit-html/directives/live.js';
export { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
export { unsafeSVG } from 'lit-html/directives/unsafe-svg.js';
