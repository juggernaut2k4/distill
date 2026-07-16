'use client'

import { SignIn } from '@clerk/nextjs'

export default function SignInPage() {
  return (
    <div className="min-h-screen bg-void flex items-center justify-center">
      <SignIn
        fallbackRedirectUrl="/dashboard/configurator"
        signUpForceRedirectUrl="/onboarding"
        appearance={{
          variables: {
            colorBackground: '#111111',
            colorText: '#ffffff',
            colorPrimary: '#7C3AED',
            colorInputBackground: '#1A1A1A',
            colorInputText: '#ffffff',
          },
          elements: {
            socialButtonsBlockButton: '!bg-white !text-gray-900 !border !border-gray-300 hover:!bg-gray-100 hover:!text-gray-900',
            socialButtonsBlockButtonText: '!text-gray-900 !font-medium',
            socialButtonsBlockButtonArrow: '!text-gray-900',
          },
        }}
      />
    </div>
  )
}
