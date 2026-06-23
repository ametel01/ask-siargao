import { memo, splitProps } from '../helpers.mjs';
import { createRecipe, mergeRecipes } from './create-recipe.mjs';

const headerFn = /* @__PURE__ */ createRecipe('header', {}, [])

const headerVariantMap = {}

const headerVariantKeys = Object.keys(headerVariantMap)

export const header = /* @__PURE__ */ Object.assign(memo(headerFn.recipeFn), {
  __recipe__: true,
  __name__: 'header',
  __getCompoundVariantCss__: headerFn.__getCompoundVariantCss__,
  raw: (props) => props,
  variantKeys: headerVariantKeys,
  variantMap: headerVariantMap,
  merge(recipe) {
    return mergeRecipes(this, recipe)
  },
  splitVariantProps(props) {
    return splitProps(props, headerVariantKeys)
  },
  getVariantProps: headerFn.getVariantProps,
})