'use client'

import { SignIn } from '@clerk/nextjs'

export default function SignInPage() {
  return (
    <div className="min-h-screen bg-void flex items-center justify-center">
      <SignIn
        appearance={{
          variables: {
            colorBackground: '#111111',
            colorText: '#ffffff',
            colorPrimary: '#7C3AED',
            colorInputBackground: '#1A1A1A',
            colorInputText: '#ffffff',
          },
          elements: {
            socialButtonsBlockButton: {
              backgroundColor: '#ffffff',
              color: '#111111',
              border: '1px solid #333333',
            },
            socialButtonsBlockButtonText: {
              color: '#111111',
              fontWeight: '500',
            },
          },
        }}
      />
    </div>
  )
}
