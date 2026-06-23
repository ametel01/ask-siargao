import { memo, splitProps } from '../helpers.mjs';
import { createRecipe, mergeRecipes } from './create-recipe.mjs';

const miniFeatureCardFn = /* @__PURE__ */ createRecipe('mini-feature-card', {}, [])

const miniFeatureCardVariantMap = {}

const miniFeatureCardVariantKeys = Object.keys(miniFeatureCardVariantMap)

export const miniFeatureCard = /* @__PURE__ */ Object.assign(memo(miniFeatureCardFn.recipeFn), {
  __recipe__: true,
  __name__: 'miniFeatureCard',
  __getCompoundVariantCss__: miniFeatureCardFn.__getCompoundVariantCss__,
  raw: (props) => props,
  variantKeys: miniFeatureCardVariantKeys,
  variantMap: miniFeatureCardVariantMap,
  merge(recipe) {
    return mergeRecipes(this, recipe)
  },
  splitVariantProps(props) {
    return splitProps(props, miniFeatureCardVariantKeys)
  },
  getVariantProps: miniFeatureCardFn.getVariantProps,
})