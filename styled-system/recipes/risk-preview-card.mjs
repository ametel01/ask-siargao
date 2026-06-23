import { memo, splitProps } from '../helpers.mjs';
import { createRecipe, mergeRecipes } from './create-recipe.mjs';

const riskPreviewCardFn = /* @__PURE__ */ createRecipe('risk-preview-card', {}, [])

const riskPreviewCardVariantMap = {}

const riskPreviewCardVariantKeys = Object.keys(riskPreviewCardVariantMap)

export const riskPreviewCard = /* @__PURE__ */ Object.assign(memo(riskPreviewCardFn.recipeFn), {
  __recipe__: true,
  __name__: 'riskPreviewCard',
  __getCompoundVariantCss__: riskPreviewCardFn.__getCompoundVariantCss__,
  raw: (props) => props,
  variantKeys: riskPreviewCardVariantKeys,
  variantMap: riskPreviewCardVariantMap,
  merge(recipe) {
    return mergeRecipes(this, recipe)
  },
  splitVariantProps(props) {
    return splitProps(props, riskPreviewCardVariantKeys)
  },
  getVariantProps: riskPreviewCardFn.getVariantProps,
})