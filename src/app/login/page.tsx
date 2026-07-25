'use client';

import { useState, useTransition, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Loader2, LogIn, UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth, useUser } from '@/firebase';
import { initiateEmailSignIn, initiateEmailSignUp, initiateAnonymousSignIn } from '@/firebase/non-blocking-login';
import { useToast } from '@/hooks/use-toast';
import { onAuthStateChanged } from 'firebase/auth';
import type { FirebaseError } from '@firebase/util';

const formSchema = z.object({
  email: z.string().email({ message: 'Voer een geldig e-mailadres in.' }),
  password: z
    .string()
    .min(6, { message: 'Wachtwoord moet minimaal 6 karakters bevatten.' }),
});

export default function LoginPage() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const auth = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useUser();

  useEffect(() => {
    // Redirect if user is already logged in
    if (user) {
      router.push('/');
    }
  }, [user, router]);
  
  // Listen for auth state changes to handle post-login/signup redirection
  useEffect(() => {
    if (!auth) return;
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        toast({
          title: 'Succesvol ingelogd',
          description: `Welkom ${user.email || 'terug'}!`,
        });
        router.push('/');
      }
    }, (error) => {
        setError(error.message);
    });

    return () => unsubscribe();
  }, [auth, router, toast]);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });
  
  const handleAuthError = (e: FirebaseError) => {
    switch (e.code) {
        case 'auth/invalid-credential':
          setError('Ongeldige inloggegevens. Controleer uw e-mail en wachtwoord.');
          break;
        case 'auth/email-already-in-use':
          setError('Dit e-mailadres is al in gebruik.');
          break;
        case 'auth/weak-password':
            setError('Het wachtwoord is te zwak. Gebruik minimaal 6 karakters.');
            break;
        default:
          setError(e.message || 'Er is een onbekende fout opgetreden.');
          break;
      }
  }


  const handleAction = (action: 'signIn' | 'signUp' | 'anonymous') => {
    if (!auth) {
        setError("Authenticatie-service is niet beschikbaar.");
        return;
    }
    startTransition(() => {
      setError(null);
      const { email, password } = form.getValues();

      if (action === 'signIn') {
        initiateEmailSignIn(auth, email, password, handleAuthError);
      } else if (action === 'signUp') {
        initiateEmailSignUp(auth, email, password, handleAuthError);
      } else if (action === 'anonymous') {
        initiateAnonymousSignIn(auth, handleAuthError);
      }
    });
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader>
          <CardTitle>Inloggen</CardTitle>
          <CardDescription>
            Log in op uw Engineer Flow-account om diagnoses op te slaan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>E-mail</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="monteur@garage.nl"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Wachtwoord</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="••••••••" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </form>
          </Form>

          {error && <p className="text-sm text-destructive mt-4">{error}</p>}

          <div className="space-y-2 mt-6">
            <Button
              onClick={() => handleAction('signIn')}
              disabled={isPending}
              className="w-full"
            >
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <LogIn className="mr-2 h-4 w-4" />
              Inloggen
            </Button>
            <Button
              onClick={() => handleAction('signUp')}
              disabled={isPending}
              variant="secondary"
              className="w-full"
            >
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <UserPlus className="mr-2 h-4 w-4" />
              Registreren
            </Button>
          </div>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                Of ga verder zonder account
              </span>
            </div>
          </div>

          <Button
            onClick={() => handleAction('anonymous')}
            disabled={isPending}
            variant="outline"
            className="w-full"
          >
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Anoniem Doorgaan
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
