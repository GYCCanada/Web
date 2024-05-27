import { useEffect } from 'react';
import { toast as showToast } from 'sonner';

import { useTranslate } from './localization/context.js';
import { type Toast } from './toast.server.js';

export function useToast(toast?: Toast | null) {
  const translate = useTranslate();
  useEffect(() => {
    if (toast) {
      setTimeout(() => {
        showToast[toast.type](translate(toast.title as any), {
          id: toast.id,
          description: translate(toast.description as any),
        });
      }, 0);
    }
  }, [toast, translate]);
}
