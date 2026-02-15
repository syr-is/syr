/**
 * Remark plugin that transforms ```mermaid code blocks into
 * <pre class="mermaid"> elements for client-side rendering by mermaid.js.
 *
 * This avoids Shiki trying to syntax-highlight mermaid blocks and instead
 * outputs raw HTML that the mermaid library picks up and renders as SVG diagrams.
 */
import { visit } from 'unist-util-visit';

/** @type {import('unified').Plugin} */
export function remarkMermaid() {
	return (/** @type {import('mdast').Root} */ tree) => {
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

			/** @type {import('mdast').Html} */
			const htmlNode = {
				type: 'html',
				value: `<pre class="mermaid">\n${value}\n</pre>`
			};

			parent.children[index] = htmlNode;
		});
	};
}
