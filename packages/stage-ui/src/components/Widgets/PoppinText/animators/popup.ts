import type { Animator } from '.'

import { createTimeline } from 'animejs'

export const popupAnimator: Animator = (elements: HTMLElement[]) => {
  const timeline = createTimeline({ loop: true })
    .set(elements, {
      opacity: 0,
      translateY: '1.1em',
      translateZ: 0,
    })
    .add(elements, {
      opacity: [0, 1],
      translateY: ['1.1em', 0],
      translateZ: 0,
      duration: 750,
      delay: (_, i) => 50 * i,
    })

  return () => {
    timeline.remove(elements)
  }
}
