import { memo, splitProps } from '../helpers.mjs';
import { createRecipe, mergeRecipes } from './create-recipe.mjs';

const pricingCardFn = /* @__PURE__ */ createRecipe('pricing-card', {}, [])

const pricingCardVariantMap = {}

const pricingCardVariantKeys = Object.keys(pricingCardVariantMap)

export const pricingCard = /* @__PURE__ */ Object.assign(memo(pricingCardFn.recipeFn), {
  __recipe__: true,
  __name__: 'pricingCard',
  __getCompoundVariantCss__: pricingCardFn.__getCompoundVariantCss__,
  raw: (props) => props,
  variantKeys: pricingCardVariantKeys,
  variantMap: pricingCardVariantMap,
  merge(recipe) {
    return mergeRecipes(this, recipe)
  },
  splitVariantProps(props) {
    return splitProps(props, pricingCardVariantKeys)
  },
  getVariantProps: pricingCardFn.getVariantProps,
})