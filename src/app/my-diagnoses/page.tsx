"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useUser } from '@/firebase';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { listDiagnoses } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  const { user, isUserLoading } = useUser();
  const [apiDiagnoses, setApiDiagnoses] = useState<any[] | null>(null);
  const [apiLoading, setApiLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [clusterFilter, setClusterFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [debouncedCluster, setDebouncedCluster] = useState(clusterFilter);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  // Debounce vrije-tekstvelden om een API-call per toetsaanslag te voorkomen.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedCluster(clusterFilter), 300);
    return () => clearTimeout(timer);
  }, [clusterFilter]);

  const loadDiagnoses = (nextOffset = offset) => {
    if (!user) {
      setApiDiagnoses(null);
      return;
    }

    let active = true;
    setApiLoading(true);
    setApiError(null);
    void listDiagnoses({ offset: nextOffset, limit: 25, query: debouncedSearch || undefined, status: statusFilter || undefined, cluster: debouncedCluster || undefined, fromDate: fromDate ? `${fromDate}T00:00:00Z` : undefined, toDate: toDate ? `${toDate}T23:59:59Z` : undefined }).then((response) => {
      if (!active) return;
      if (response.data) {
        setApiDiagnoses(response.data.diagnoses.map((item) => ({
          id: item.diagnosis_id,
          diagnosisId: item.diagnosis_id,
          title: item.metadata.title || item.symptom_text,
          symptomText: item.symptom_text,
          createdAt: item.created_at,
          reliabilityScore: item.response.confidence_score || 0,
          status: item.metadata.status || (item.metadata.confirmed_fix_id ? 'resolved' : 'under_investigation'),
          caseId: item.case_id,
          caseStatus: item.case_status,
          serviceFlow: item.metadata.service_flow,
       })));
         setOffset(response.data.pagination?.offset ?? nextOffset);
         setHasMore(response.data.pagination?.has_more ?? false);
       } else {
         setApiError(response.error || 'Kon diagnoses niet laden.');
       }
      setApiLoading(false);
    });

    return () => {
      active = false;
    };
  };

  useEffect(() => loadDiagnoses(0), [user, debouncedSearch, statusFilter, debouncedCluster, fromDate, toDate]);

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/login');
    }
  }, [isUserLoading, user, router]);

  const displayedDiagnoses = apiDiagnoses ?? [];

  if (isUserLoading || apiLoading) {
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
          <div className="flex flex-col gap-2 md:flex-row">
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Zoek op diagnose of symptoom" />
            <Input value={clusterFilter} onChange={(event) => setClusterFilter(event.target.value)} placeholder="Cluster" />
            <select className="h-10 rounded-md border bg-background px-3 text-sm" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">Alle statussen</option>
              <option value="under_investigation">In onderzoek</option>
              <option value="resolved">Opgelost</option>
            </select>
            <Input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} aria-label="Vanaf datum" />
            <Input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} aria-label="Tot datum" />
          </div>
        </CardHeader>
        <CardContent>
          {apiError && (
            <Alert variant="destructive" className="mb-4">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Fout</AlertTitle>
              <AlertDescription>
                {apiError}
                <Button className="ml-3" size="sm" variant="outline" onClick={() => loadDiagnoses()}>Opnieuw proberen</Button>
              </AlertDescription>
            </Alert>
          )}

          {displayedDiagnoses && displayedDiagnoses.length > 0 ? (
            <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Datum</TableHead>
                  <TableHead>Titel</TableHead>
                  <TableHead className="text-center">Score</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="text-center">Case</TableHead>
                  <TableHead className="text-right"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayedDiagnoses.map((diag) => (
                  <TableRow key={diag.id || diag.diagnosisId}>
                    <TableCell>
                      {typeof diag.createdAt === 'string'
                        ? new Date(diag.createdAt).toLocaleDateString('nl-NL')
                        : diag.createdAt?.toDate().toLocaleDateString('nl-NL')}
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
                    <TableCell className="text-center">
                      <Badge variant="outline">{diag.caseStatus || 'onbekend'}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => router.push(`/my-diagnoses/${diag.diagnosisId || diag.id}`)}
                      >
                        <Wrench className="mr-2 h-3 w-3" />
                        Openen
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="mt-4 flex justify-between">
              <Button variant="outline" disabled={offset === 0} onClick={() => loadDiagnoses(Math.max(0, offset - 25))}>Vorige</Button>
              <Button variant="outline" disabled={!hasMore} onClick={() => loadDiagnoses(offset + 25)}>Volgende</Button>
            </div>
            </>
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
