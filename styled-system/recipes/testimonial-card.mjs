import { memo, splitProps } from '../helpers.mjs';
import { createRecipe, mergeRecipes } from './create-recipe.mjs';

const testimonialCardFn = /* @__PURE__ */ createRecipe('testimonial-card', {}, [])

const testimonialCardVariantMap = {}

const testimonialCardVariantKeys = Object.keys(testimonialCardVariantMap)

export const testimonialCard = /* @__PURE__ */ Object.assign(memo(testimonialCardFn.recipeFn), {
  __recipe__: true,
  __name__: 'testimonialCard',
  __getCompoundVariantCss__: testimonialCardFn.__getCompoundVariantCss__,
  raw: (props) => props,
  variantKeys: testimonialCardVariantKeys,
  variantMap: testimonialCardVariantMap,
  merge(recipe) {
    return mergeRecipes(this, recipe)
  },
  splitVariantProps(props) {
    return splitProps(props, testimonialCardVariantKeys)
  },
  getVariantProps: testimonialCardFn.getVariantProps,
})