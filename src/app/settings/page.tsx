

"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Settings,
  User,
  Palette,
  Bell,
  Database,
  Shield,
  SlidersHorizontal,
  Mail,
  Building,
  Award,
  KeyRound,
  Star,
  Users,
  Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  id: string;
  label: string;
  icon: React.ElementType;
};

const navItems: NavItem[] = [
  { id: "account", label: "Account & Licentie", icon: User },
  { id: "appearance", label: "Uiterlijk", icon: Palette },
  { id: "notifications", label: "Meldingen", icon: Bell },
  { id: "data", label: "Data & Opslag", icon: Database },
  { id: "security", label: "Beveiliging", icon: Shield },
  { id: "advanced", label: "Geavanceerd", icon: SlidersHorizontal },
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState("account");

  return (
    <div className="container mx-auto p-4 md:p-8">
      <div className="mb-6">
        <Link href="/" passHref>
          <Button variant="outline">
            <ArrowLeft className="mr-2" />
            Terug naar Home
          </Button>
        </Link>
      </div>

      <header className="mb-8">
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <Settings className="h-8 w-8" />
          Instellingen
        </h1>
        <p className="text-muted-foreground mt-1">
          Pas uw Engineer Flow ervaring aan
        </p>
      </header>

      <div className="grid md:grid-cols-[250px_1fr] gap-8">
        <aside>
          <h2 className="text-lg font-semibold mb-3 px-2">Modules</h2>
          <nav className="flex flex-col gap-1">
            {navItems.map((item) => (
              <Button
                key={item.id}
                variant={activeTab === item.id ? "secondary" : "ghost"}
                className="justify-start"
                onClick={() => setActiveTab(item.id)}
              >
                <item.icon className="mr-3 h-5 w-5" />
                {item.label}
              </Button>
            ))}
          </nav>
        </aside>

        <main>
          {activeTab === "account" && (
            <div className="space-y-8">
              <Card>
                <CardHeader>
                  <CardTitle>Account Informatie</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">Naam</Label>
                      <Input id="name" placeholder="Uw naam" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email">E-mail</Label>
                      <Input id="email" type="email" placeholder="naam@bedrijf.nl" />
                    </div>
                  </div>
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="company">Bedrijf</Label>
                        <Input id="company" placeholder="Bedrijfsnaam" />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="role">Rol</Label>
                        <Input id="role" placeholder="Functie" />
                    </div>
                  </div>
                  <Separator />
                    <div>
                        <h3 className="font-semibold mb-2">Wachtwoord wijzigen</h3>
                        <Button variant="outline" disabled>
                            <KeyRound className="mr-2"/>
                            Wachtwoord instellen
                        </Button>
                    </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Licentie Informatie</CardTitle>
                  <CardDescription>Beheer uw plan en actieve modules</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-lg bg-secondary">
                    <div>
                        <h3 className="font-semibold text-lg flex items-center gap-2">
                            <Star className="text-accent"/>
                            Professional Plan
                        </h3>
                        <p className="text-muted-foreground">€299/maand</p>
                    </div>
                    <Badge variant="default" className="bg-green-600 hover:bg-green-700 text-lg">Actief</Badge>
                  </div>

                  <div className="space-y-3">
                    <div>
                        <p className="text-sm text-muted-foreground">Licentienummer</p>
                        <p className="font-mono text-sm">EF-PRO-2024-A7X9-K4M2-P8L6</p>
                    </div>
                     <div>
                        <p className="text-sm text-muted-foreground">Vervaldatum</p>
                        <p className="font-semibold">31 December 2025</p>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-center">
                    <div className="p-3 bg-background rounded-md border">
                        <Layers className="mx-auto mb-1 text-primary"/>
                        <p className="font-bold text-xl">3 <span className="text-sm font-normal text-muted-foreground">/ 60</span></p>
                        <p className="text-xs text-muted-foreground">Actieve Modules</p>
                    </div>
                    <div className="p-3 bg-background rounded-md border">
                        <Users className="mx-auto mb-1 text-primary"/>
                        <p className="font-bold text-xl">1 <span className="text-sm font-normal text-muted-foreground">/ 5</span></p>
                        <p className="text-xs text-muted-foreground">Gebruikers</p>
                    </div>
                    <div className="p-3 bg-background rounded-md border">
                        <Award className="mx-auto mb-1 text-primary"/>
                        <p className="font-bold text-xl">Pro</p>
                        <p className="text-xs text-muted-foreground">Tier</p>
                    </div>
                  </div>

                  <Separator />

                  <div className="flex flex-wrap justify-between items-center gap-4">
                    <p className="text-sm text-muted-foreground">Automatische verlenging op 31 december 2025</p>
                    <Button variant="outline" size="sm" disabled>Uitbreiding Aanvragen</Button>
                  </div>
                </CardContent>
              </Card>

              <div className="flex justify-end gap-2">
                <Button variant="ghost" disabled>Annuleren</Button>
                <Button disabled>Opslaan</Button>
              </div>
            </div>
          )}

          {activeTab !== "account" && (
            <Card>
                <CardHeader>
                    <CardTitle className="capitalize">{activeTab}</CardTitle>
                    <CardDescription>Instellingen voor {activeTab}.</CardDescription>
                </CardHeader>
                <CardContent className="flex items-center justify-center h-64 border-2 border-dashed rounded-lg">
                    <p className="text-muted-foreground">Deze sectie is nog in ontwikkeling.</p>
                </CardContent>
            </Card>
          )}
        </main>
      </div>
    </div>
  );
}
