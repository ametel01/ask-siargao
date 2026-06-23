import { memo, splitProps } from '../helpers.mjs';
import { createRecipe, mergeRecipes } from './create-recipe.mjs';

const trustCardFn = /* @__PURE__ */ createRecipe('trust-card', {}, [])

const trustCardVariantMap = {}

const trustCardVariantKeys = Object.keys(trustCardVariantMap)

export const trustCard = /* @__PURE__ */ Object.assign(memo(trustCardFn.recipeFn), {
  __recipe__: true,
  __name__: 'trustCard',
  __getCompoundVariantCss__: trustCardFn.__getCompoundVariantCss__,
  raw: (props) => props,
  variantKeys: trustCardVariantKeys,
  variantMap: trustCardVariantMap,
  merge(recipe) {
    return mergeRecipes(this, recipe)
  },
  splitVariantProps(props) {
    return splitProps(props, trustCardVariantKeys)
  },
  getVariantProps: trustCardFn.getVariantProps,
})