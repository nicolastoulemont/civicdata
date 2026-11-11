import { eslintCompatPlugin } from "@oxlint/plugins"

const attributes = new Set([
  "alt",
  "title",
  "label",
  "description",
  "placeholder",
  "removeLabel",
  "labels",
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
])

const words = (value) => /\p{L}/u.test(value)

const brand = new Set([
  "civicdata",
  "World Bank",
  "Eurostat",
  "OECD",
  "Wikidata",
  "GitHub",
  "Enter",
  "Escape",
  "PPEG",
  "ParlGov",
])

const unwrap = (node) => [node.expression]
const sides = (node) => [node.left, node.right]

const noRawText = {
  meta: {
    type: "problem",
    docs: { description: "Require i18n for frontend text and accessible names." },
    schema: [],
    messages: { raw: "Move this frontend text into a locale catalog and render it with i18n." },
  },
  create(context) {
    const reported = new WeakSet()

    const report = (node, value) => {
      if (reported.has(node)) return

      if (words(value) && !brand.has(value.trim().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ""))) {
        reported.add(node)
        context.report({ node, messageId: "raw" })
      }
    }

    const binding = (node) => {
      let scope = context.sourceCode.getScope(node)

      while (scope) {
        const variable = scope.set.get(node.name)

        if (variable) return variable.defs.find((def) => def.type === "Variable")?.node.init

        scope = scope.upper
      }

      return undefined
    }

    const member = (node) => {
      const object = node.object.type === "Identifier" ? binding(node.object) : node.object
      const key = node.computed ? node.property.value : node.property.name

      if (object?.type !== "ObjectExpression") return undefined

      return object.properties.find(
        (property) =>
          property.type === "Property" && (property.key.name ?? property.key.value) === key,
      )?.value
    }

    const children = {
      Identifier: (node) => [binding(node)],
      MemberExpression: (node) => [member(node)],
      Literal: (node) => {
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- ESTree Literal values are a defined union; select the string member.
        if (typeof node.value === "string") report(node, node.value)

        return []
      },
      TemplateLiteral: (node) => {
        for (const quasi of node.quasis) report(quasi, quasi.value.cooked ?? quasi.value.raw)

        return node.expressions
      },
      ConditionalExpression: (node) => [node.consequent, node.alternate],
      LogicalExpression: sides,
      BinaryExpression: sides,
      ArrayExpression: (node) => node.elements,
      TSAsExpression: unwrap,
      TSSatisfiesExpression: unwrap,
      TSNonNullExpression: unwrap,
    }

    // Calls such as t(...) and imported/fetched data keep their own contracts.
    // Walk local constants and display branches, once per node to stop cycles.
    const expression = (node, seen = new Set()) => {
      if (!node || seen.has(node)) return

      seen.add(node)

      for (const child of children[node.type]?.(node) ?? []) expression(child, seen)
    }

    return {
      JSXText(node) {
        report(node, node.value)
      },
      JSXAttribute(node) {
        if (!attributes.has(node.name.name)) return

        if (node.value?.type === "JSXExpressionContainer") expression(node.value.expression)
        else expression(node.value)
      },
      JSXExpressionContainer(node) {
        if (node.parent.type !== "JSXAttribute") expression(node.expression)
      },
      Property(node) {
        const key = node.key.name ?? node.key.value

        if (attributes.has(key)) expression(node.value)
      },
    }
  },
}

export default eslintCompatPlugin({
  meta: { name: "i18n" },
  rules: { "no-raw-text": noRawText },
})
