
import React from 'react'
import { JSX } from 'react'
import { Weak } from '../../../../helpers'
import { PropsUIButtonBack, PropsUIButtonForward, PropsUIButtonIcon, PropsUIButtonIconBack, PropsUIButtonIconForward, PropsUIButtonIconLabel, PropsUIButtonLabel, PropsUIButtonPrimary, PropsUIButtonSecundary } from '../../../../types/elements'

import BackSvg from '../../../../../assets/images/back.svg'
import ForwardSvg from '../../../../../assets/images/forward.svg'
import { Spinner } from './spinner'

// Every button is a real <button>: reachable with Tab, pressed with Enter or Space, announced as a
// button, and really disabled when it can't be used. `btn-focus` (styles.css) is the visible focus.

function spinnerColor (buttonColor: string): string {
  if (buttonColor.includes('bg-tertiary')) {
    return 'dark'
  }
  return 'light'
}

export const PrimaryButton = ({ label, spinning = false, enabled = true, color = 'bg-primary text-white', onClick }: Weak<PropsUIButtonPrimary>): JSX.Element => {
  return (
    <button
      type='button'
      disabled={!enabled}
      aria-busy={spinning}
      className={`btn-focus relative flex flex-col items-center leading-none font-button text-button rounded ${enabled ? 'cursor-pointer active:shadow-top4px' : 'cursor-not-allowed'} ${color}`}
      onClick={onClick}
    >
      <span className={`pt-15px pb-15px pr-4 pl-4 ${enabled ? 'active:pt-4 active:pb-14px' : ''} ${spinning ? 'invisible' : ''}`}>
        {label}
      </span>
      <span className={`absolute inset-0 flex items-center justify-center ${spinning ? '' : 'hidden'}`}>
        <Spinner color={spinnerColor(color)} spinning={spinning} />
      </span>
    </button>
  )
}

export const SecondaryButton = ({ label, color = 'bg-delete text-delete', onClick }: Weak<PropsUIButtonSecundary>): JSX.Element => {
  return (
    <button
      type='button'
      className={`btn-focus flex flex-col items-center active:shadow-top2px border-2 font-button text-button rounded bg-opacity-0 cursor-pointer ${color}`}
      onClick={onClick}
    >
      <span className='pt-13px pb-13px pr-4 pl-4 active:pt-14px active:pb-3'>
        {label}
      </span>
    </button>
  )
}

export const BackButton = ({ label, onClick }: Weak<PropsUIButtonBack>): JSX.Element => {
  return <IconLabelButton icon={BackSvg} label={label} onClick={onClick} />
}

export const ForwardButton = ({ label, onClick }: Weak<PropsUIButtonForward>): JSX.Element => {
  return <IconLabelButton icon={ForwardSvg} label={label} onClick={onClick} alignment='right' />
}

export const BackIconButton = ({ onClick }: Weak<PropsUIButtonIconBack>): JSX.Element => {
  return <IconButton icon={BackSvg} onClick={onClick} label='Back' />
}

export const ForwardIconButton = ({ onClick }: Weak<PropsUIButtonIconForward>): JSX.Element => {
  return <IconButton icon={ForwardSvg} onClick={onClick} label='Forward' />
}

// An icon has no text of its own, so the button is named by `label`.
export const IconButton = ({ icon, onClick, label }: Weak<PropsUIButtonIcon> & { label?: string }): JSX.Element => {
  return (
    <button type='button' aria-label={label} className='btn-focus active:pt-5px active:pb-3px cursor-pointer w-6 h-6' onClick={onClick}>
      <span className='flex flex-col items-center justify-center h-full w-full'>
        <img className='-mt-2px' src={icon} alt='' />
      </span>
    </button>
  )
}

export const IconLabelButton = ({ icon, label, color = 'text-grey1', alignment = 'left', onClick }: Weak<PropsUIButtonIconLabel>): JSX.Element => {
  return (
    <button type='button' className='btn-focus pt-1 pb-1 active:pt-5px active:pb-3px rounded bg-opacity-0 cursor-pointer' onClick={onClick}>
      <span className='flex items-center'>
        {/* The label names the button; the arrow is decoration. */}
        <img className={`mr-2 -mt-2px ${alignment === 'left' ? '' : 'hidden'}`} src={icon} alt='' />
        <span className={`flex-wrap text-button font-button ${color}`}>
          {label}
        </span>
        <img className={`ml-2 -mt-2px ${alignment !== 'left' ? '' : 'hidden'}`} src={icon} alt='' />
      </span>
    </button>
  )
}

export const LabelButton = ({ label, color = 'text-grey1', onClick }: Weak<PropsUIButtonLabel>): JSX.Element => {
  return (
    <button type='button' className={`btn-focus pt-15px pb-15px active:pt-4 active:pb-14px leading-none font-button text-button rounded pr-4 pl-4 cursor-pointer bg-opacity-0 ${color}`} onClick={onClick}>
      {label}
    </button>
  )
}
