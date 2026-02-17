<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { onMount } from 'svelte';

	const { children } = $props();

	const MERMAID_SOURCE_ATTR = 'data-mermaid-source';

	function getMermaidTheme(): 'default' | 'dark' {
		return document.documentElement.classList.contains('dark') ? 'dark' : 'default';
	}

	/** Restore diagram source into pre.mermaid nodes that were already rendered (so we can re-run with new theme). */
	function restoreMermaidSources(): void {
		const nodes = document.querySelectorAll<HTMLPreElement>(`pre.mermaid[${MERMAID_SOURCE_ATTR}]`);
		for (const node of nodes) {
			const source = node.getAttribute(MERMAID_SOURCE_ATTR);
			if (source != null) node.textContent = source;
			node.removeAttribute('data-processed');
		}
	}

	async function renderMermaid() {
		const nodes = document.querySelectorAll<HTMLPreElement>('pre.mermaid');
		if (nodes.length === 0) return;

		// Persist source so we can re-render on theme change (mermaid replaces content with SVG)
		for (const node of nodes) {
			if (!node.hasAttribute(MERMAID_SOURCE_ATTR) && node.textContent?.trim()) {
				node.setAttribute(MERMAID_SOURCE_ATTR, node.textContent);
			}
		}

		const { default: mermaid } = await import('mermaid');
		const theme = getMermaidTheme();
		mermaid.initialize({
			startOnLoad: false,
			theme,
			securityLevel: 'strict',
			fontFamily: 'inherit'
		});

		await mermaid.run({ nodes });
	}

	// Runs on initial page load and after every client-side navigation
	afterNavigate(() => {
		renderMermaid();
	});

	// Re-render Mermaid when SveltePress theme (dark/light) changes
	onMount(() => {
		const observer = new MutationObserver(() => {
			const hasPreMermaid = document.querySelector('pre.mermaid');
			if (!hasPreMermaid) return;
			restoreMermaidSources();
			renderMermaid();
		});
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['class']
		});
		return () => observer.disconnect();
	});
</script>

{@render children?.()}
