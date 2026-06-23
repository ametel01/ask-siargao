import { memo, splitProps } from '../helpers.mjs';
import { createRecipe, mergeRecipes } from './create-recipe.mjs';

const processCardFn = /* @__PURE__ */ createRecipe('process-card', {}, [])

const processCardVariantMap = {}

const processCardVariantKeys = Object.keys(processCardVariantMap)

export const processCard = /* @__PURE__ */ Object.assign(memo(processCardFn.recipeFn), {
  __recipe__: true,
  __name__: 'processCard',
  __getCompoundVariantCss__: processCardFn.__getCompoundVariantCss__,
  raw: (props) => props,
  variantKeys: processCardVariantKeys,
  variantMap: processCardVariantMap,
  merge(recipe) {
    return mergeRecipes(this, recipe)
  },
  splitVariantProps(props) {
    return splitProps(props, processCardVariantKeys)
  },
  getVariantProps: processCardFn.getVariantProps,
})