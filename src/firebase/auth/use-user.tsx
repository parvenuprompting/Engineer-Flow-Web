'use client';

import { useContext } from 'react';
import { FirebaseContext, UserHookResult } from '@/firebase/provider';

/**
 * Hook specifically for accessing the authenticated user's state.
 * This provides the User object, loading status, and any auth errors.
 * @returns {UserHookResult} Object with user, isUserLoading, userError.
 */
export const useUser = (): UserHookResult => {
  const context = useContext(FirebaseContext);

  if (context === undefined) {
    throw new Error('useUser must be used within a FirebaseProvider.');
  }
  
  // Return only the user-related state from the main context
  return { 
    user: context.user, 
    isUserLoading: context.isUserLoading, 
    userError: context.userError 
  };
};
