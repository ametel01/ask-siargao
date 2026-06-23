import { memo, splitProps } from '../helpers.mjs';
import { createRecipe, mergeRecipes } from './create-recipe.mjs';

const footerFn = /* @__PURE__ */ createRecipe('footer', {}, [])

const footerVariantMap = {}

const footerVariantKeys = Object.keys(footerVariantMap)

export const footer = /* @__PURE__ */ Object.assign(memo(footerFn.recipeFn), {
  __recipe__: true,
  __name__: 'footer',
  __getCompoundVariantCss__: footerFn.__getCompoundVariantCss__,
  raw: (props) => props,
  variantKeys: footerVariantKeys,
  variantMap: footerVariantMap,
  merge(recipe) {
    return mergeRecipes(this, recipe)
  },
  splitVariantProps(props) {
    return splitProps(props, footerVariantKeys)
  },
  getVariantProps: footerFn.getVariantProps,
})