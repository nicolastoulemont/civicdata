import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

import { functionParameterTypeAnnotation } from "../shared/function-parameters.ts";

type Component = ESTree.ArrowFunctionExpression | ESTree.Function;

interface Candidate {
	readonly node: Component;
	readonly name: string;
	renders: boolean;
}

const isComponentName = (name: string) => /^[A-Z]/.test(name);

/** A function's own name, or the name of the variable it initializes. */
function bindingName(node: Component): string | null {
	if (node.type !== "ArrowFunctionExpression" && node.id) return node.id.name;
	const parent = node.parent;
	if (parent.type === "VariableDeclarator" && parent.id.type === "Identifier") {
		return parent.id.name;
	}
	return null;
}

/** Require a React component's props parameter to use a named `{Component}Props` type. */
export const requireNamedPropsTypeRule = defineRule({
	meta: {
		type: "suggestion",
		docs: {
			description:
				"Require React component props to use a type named after the component, never an inline type.",
		},
		messages: {
			propsType:
				"Type the props of `{{component}}` as `{{expected}}`. Declare `interface {{expected}}` (or `type {{expected}}`) instead of an inline or differently named type.",
		},
	},
	createOnce(context) {
		const candidates: Array<Candidate> = [];

		const enter = (node: Component) => {
			const name = bindingName(node);
			if (name === null || !isComponentName(name)) return;
			candidates.push({ node, name, renders: false });
		};

		const exit = (node: Component) => {
			const candidate = candidates.at(-1);
			if (candidate?.node !== node) return;
			candidates.pop();
			if (!candidate.renders) return;

			const [props] = node.params;
			if (props === undefined) return;
			const annotation = functionParameterTypeAnnotation(props);
			if (annotation === null || annotation === undefined) return;

			const expected = `${candidate.name}Props`;
			const type = annotation.typeAnnotation;
			if (
				type.type === "TSTypeReference" &&
				type.typeName.type === "Identifier" &&
				type.typeName.name === expected
			) {
				return;
			}
			context.report({
				node: type,
				messageId: "propsType",
				data: { component: candidate.name, expected },
			});
		};

		const render = () => {
			for (const candidate of candidates) candidate.renders = true;
		};

		return {
			ArrowFunctionExpression: enter,
			FunctionDeclaration: enter,
			FunctionExpression: enter,
			"ArrowFunctionExpression:exit": exit,
			"FunctionDeclaration:exit": exit,
			"FunctionExpression:exit": exit,
			JSXElement: render,
			JSXFragment: render,
		};
	},
});
