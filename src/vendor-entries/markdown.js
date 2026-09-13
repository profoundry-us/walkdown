/*
 * What thread bodies are rendered with: marked parses the markdown, and
 * DOMPurify decides what of the result may reach the page. Both are named
 * here so the vendor bundle carries exactly this and nothing silently more.
 *
 * Two libraries rather than one because they answer different questions.
 * A body arrives from the browser (POST /api/threads) and from agents, and
 * marked will pass raw HTML through as written; the sanitiser is what makes
 * "somebody typed <script>" a piece of text rather than a script. The
 * allow-list itself lives beside the renderer (lib/message-stream.js).
 */
export { marked } from 'marked';
export { default as DOMPurify } from 'dompurify';
