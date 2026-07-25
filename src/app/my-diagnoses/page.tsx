"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  useFirestore,
  useCollection,
  useUser,
  useMemoFirebase,
} from '@/firebase';
import { collection, query, orderBy } from 'firebase/firestore';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Loader2,
  FolderArchive,
  ArrowLeft,
  PlusCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Receipt,
  Wrench,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export default function MyDiagnosesPage() {
  const router = useRouter();
  const firestore = useFirestore();
  const { user, isUserLoading } = useUser();

  const diagnosesQuery = useMemoFirebase(() => {
    if (!user) return null;
    const diagnosesCol = collection(firestore, 'diagnoses', user.uid, 'diagnoses');
    return query(diagnosesCol, orderBy('createdAt', 'desc'));
  }, [firestore, user]);

  const {
    data: diagnoses,
    isLoading,
    error,
  } = useCollection<any>(diagnosesQuery);

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/login');
    }
  }, [isUserLoading, user, router]);

  if (isLoading || isUserLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 md:p-8">
      <div className="mb-6 flex justify-between items-center">
        <Link href="/" passHref>
          <Button variant="outline">
            <ArrowLeft className="mr-2" />
            Terug naar Home
          </Button>
        </Link>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FolderArchive /> Mijn Diagnoses
        </h1>
      </div>

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>Opgeslagen Diagnostische Rapporten</CardTitle>
          <CardDescription>
            Hier vindt u al uw opgeslagen diagnoses.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Fout</AlertTitle>
              <AlertDescription>
                Kon diagnoses niet laden: {error.message}
              </AlertDescription>
            </Alert>
          )}

          {diagnoses && diagnoses.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Datum</TableHead>
                  <TableHead>Titel</TableHead>
                  <TableHead className="text-center">Score</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="text-right"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {diagnoses.map((diag) => (
                  <TableRow key={diag.id}>
                    <TableCell>
                      {diag.createdAt?.toDate().toLocaleDateString('nl-NL')}
                    </TableCell>
                    <TableCell className="font-medium max-w-sm truncate">
                      {diag.title || diag.symptomText}
                    </TableCell>
                    <TableCell className="text-center font-mono">{Math.round(diag.reliabilityScore)}%</TableCell>
                    <TableCell className="text-center">
                      <div className="flex flex-col items-center gap-1">
                        <Badge
                          className={cn(
                            "whitespace-nowrap px-2 py-0.5 text-[10px]",
                            diag.status === 'resolved'
                              ? "bg-green-500/10 text-green-600 border-green-500/20"
                              : "bg-orange-500/10 text-orange-600 border-orange-500/20"
                          )}
                          variant="outline"
                        >
                          {diag.status === 'resolved' ? (
                            <><CheckCircle2 className="mr-1 h-3 w-3" /> Opgelost</>
                          ) : (
                            <><Clock className="mr-1 h-3 w-3" /> In onderzoek</>
                          )}
                        </Badge>
                        {diag.serviceFlow?.factuurStatus === 'gefinaliseerd' && (
                          <Badge variant="outline" className="text-[10px] border-blue-500/20 text-blue-600">
                            <Receipt className="mr-1 h-3 w-3" />
                            Gefactureerd
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => router.push(`/my-diagnoses/${diag.id}`)}
                      >
                        <Wrench className="mr-2 h-3 w-3" />
                        Werkbonnen
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-12">
              <FolderArchive className="mx-auto h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">
                Nog geen diagnoses opgeslagen
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Start een nieuwe diagnose om deze hier op te slaan.
              </p>
              <Link href="/diagnose" passHref>
                <Button className="mt-4">
                  <PlusCircle className="mr-2" />
                  Nieuwe Diagnose
                </Button>
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
