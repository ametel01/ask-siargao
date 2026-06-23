import { memo, splitProps } from '../helpers.mjs';
import { createRecipe, mergeRecipes } from './create-recipe.mjs';

const pageShellFn = /* @__PURE__ */ createRecipe('page-shell', {}, [])

const pageShellVariantMap = {}

const pageShellVariantKeys = Object.keys(pageShellVariantMap)

export const pageShell = /* @__PURE__ */ Object.assign(memo(pageShellFn.recipeFn), {
  __recipe__: true,
  __name__: 'pageShell',
  __getCompoundVariantCss__: pageShellFn.__getCompoundVariantCss__,
  raw: (props) => props,
  variantKeys: pageShellVariantKeys,
  variantMap: pageShellVariantMap,
  merge(recipe) {
    return mergeRecipes(this, recipe)
  },
  splitVariantProps(props) {
    return splitProps(props, pageShellVariantKeys)
  },
  getVariantProps: pageShellFn.getVariantProps,
})