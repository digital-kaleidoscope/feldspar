import { JSX } from 'react'
import { Weak } from '../../../../helpers'
import { PropsUIProgressBar } from '../../../../types/elements'
import React from 'react'

type Props = Weak<PropsUIProgressBar>

export const ProgressBar = ({ percentage, label }: Props & { label?: string }): JSX.Element => {
  return (
    <div
      id='progress'
      role='progressbar'
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percentage)}
      className='relative w-full overflow-hidden rounded-full'
    >
      <div className='flex flex-row items-center gap-4'>
        <div className='grow h-4 bg-primarylight' />
      </div>
      <div className='absolute top-0 h-4 bg-primary' style={{ width: `${percentage}%` }} />
    </div>
  )
}
