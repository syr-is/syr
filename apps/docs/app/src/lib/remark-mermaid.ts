/**
 * Remark plugin that transforms ```mermaid code blocks into
 * <pre class="mermaid"> elements for client-side rendering by mermaid.js.
 *
 * This avoids Shiki trying to syntax-highlight mermaid blocks and instead
 * outputs raw HTML that the mermaid library picks up and renders as SVG diagrams.
 */
import type { Html, Root } from 'mdast';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';

export const remarkMermaid: Plugin<[], Root, Root> = function () {
	return (tree: Root) => {
		visit(tree, 'code', (node, index, parent) => {
			if (node.lang !== 'mermaid' || index === undefined || !parent) return;

			// Replace the code node with a raw HTML node containing
			// a <pre class="mermaid"> element that mermaid.js will render client-side.
			//
			// We must escape HTML entities AND Svelte template characters ({ and })
			// since SveltePress compiles .md files as Svelte components.
			const value = node.value
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/\{/g, '&#123;')
				.replace(/\}/g, '&#125;');

			// Wrapper enables horizontal scroll on narrow viewports (mobile)
			const htmlNode: Html = {
				type: 'html',
				value: `<div style="overflow-x: auto; margin: 1rem 0"><pre class="mermaid">\n${value}\n</pre></div>`
			};
			parent.children[index] = htmlNode;
		});
	};
};
