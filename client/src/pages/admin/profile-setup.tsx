/**
 * Profile Setup Page
 * 
 * Required before accessing any admin pages.
 * First-time users must complete their profile.
 */

import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { User, Camera, Check, ArrowRight, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  AdminProfile,
  UserRole,
  getAdminProfile,
  setAdminProfile,
  validateInviteCode,
  useInviteCode,
  generateProfileId,
  getAllProfiles,
} from "@/lib/admin-profile";

type SetupMode = "check" | "first_user" | "invite" | "complete";

export default function ProfileSetupPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const existingProfile = getAdminProfile();
  const allProfiles = getAllProfiles();
  const isFirstUser = allProfiles.length === 0;

  const [mode, setMode] = useState<SetupMode>(
    existingProfile ? "complete" : isFirstUser ? "first_user" : "check"
  );
  const [inviteCode, setInviteCode] = useState("");
  const [validatedInvite, setValidatedInvite] = useState<{ role: UserRole } | null>(null);

  const [name, setName] = useState(existingProfile?.name || "");
  const [phone, setPhone] = useState(existingProfile?.phone || "");
  const [photoUrl, setPhotoUrl] = useState(existingProfile?.photoUrl || "");
  const [isLoading, setIsLoading] = useState(false);

  const handleCheckInvite = () => {
    const invite = validateInviteCode(inviteCode.trim());
    if (invite) {
      setValidatedInvite({ role: invite.intendedRole });
      setMode("complete");
      toast({
        title: "Koodi hyväksytty",
        description: `Rooli: ${invite.intendedRole}`,
      });
    } else {
      toast({
        variant: "destructive",
        title: "Virheellinen koodi",
        description: "Tarkista kutsukoodi ja yritä uudelleen.",
      });
    }
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      toast({
        variant: "destructive",
        title: "Liian suuri kuva",
        description: "Maksimikoko on 2 MB.",
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      setPhotoUrl(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast({
        variant: "destructive",
        title: "Nimi vaaditaan",
        description: "Syötä nimesi jatkaaksesi.",
      });
      return;
    }

    if (!photoUrl) {
      toast({
        variant: "destructive",
        title: "Profiilikuva vaaditaan",
        description: "Lisää profiilikuva jatkaaksesi.",
      });
      return;
    }

    setIsLoading(true);

    let role: UserRole = "STAFF";
    let profileId = existingProfile?.id || generateProfileId();

    if (isFirstUser || mode === "first_user") {
      role = "HOST";
    } else if (validatedInvite) {
      role = validatedInvite.role;
      if (inviteCode) {
        useInviteCode(inviteCode, profileId);
      }
    } else if (existingProfile) {
      role = existingProfile.role;
      profileId = existingProfile.id;
    }

    const profile: AdminProfile = {
      id: profileId,
      name: name.trim(),
      role,
      phone: phone.trim() || undefined,
      photoUrl,
      createdAt: existingProfile?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setAdminProfile(profile);

    toast({
      title: "Profiili tallennettu",
      description: `Tervetuloa, ${name}!`,
    });

    await new Promise((r) => setTimeout(r, 300));
    navigate("/admin/dashboard");
  };

  if (mode === "check") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <KeyRound className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-2xl font-semibold text-foreground mb-2">
              Tervetuloa
            </h1>
            <p className="text-muted-foreground">
              Syötä kutsukoodisi jatkaaksesi
            </p>
          </div>

          <Card className="p-6 bg-card border-0 premium-shadow">
            <div className="space-y-4">
              <div>
                <Label htmlFor="inviteCode">Kutsukoodi</Label>
                <Input
                  id="inviteCode"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  placeholder="INV-XXXX-XXXX"
                  className="mt-2 font-mono"
                  data-testid="input-invite-code"
                />
              </div>

              <Button
                onClick={handleCheckInvite}
                className="w-full"
                disabled={!inviteCode.trim()}
                data-testid="btn-check-invite"
              >
                Jatka
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <User className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold text-foreground mb-2">
            {existingProfile ? "Muokkaa profiilia" : "Luo profiili"}
          </h1>
          <p className="text-muted-foreground">
            {isFirstUser
              ? "Olet ensimmäinen käyttäjä - saat HOST-oikeudet"
              : validatedInvite
              ? `Rooli: ${validatedInvite.role}`
              : "Täytä tietosi jatkaaksesi"}
          </p>
        </div>

        <Card className="p-6 bg-card border-0 premium-shadow">
          <div className="space-y-5">
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="relative w-24 h-24 rounded-2xl bg-muted flex items-center justify-center overflow-hidden group"
                data-testid="btn-upload-photo"
              >
                {photoUrl ? (
                  <img
                    src={photoUrl}
                    alt="Profiilikuva"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Camera className="w-8 h-8 text-muted-foreground" />
                )}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Camera className="w-6 h-6 text-white" />
                </div>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handlePhotoUpload}
                className="hidden"
              />
            </div>

            <div>
              <Label htmlFor="name">Nimi *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Koko nimesi"
                className="mt-2"
                data-testid="input-profile-name"
              />
            </div>

            <div>
              <Label htmlFor="phone">Puhelin (valinnainen)</Label>
              <Input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+358 40 123 4567"
                className="mt-2"
                data-testid="input-profile-phone"
              />
            </div>

            <Button
              onClick={handleSubmit}
              className="w-full"
              disabled={isLoading || !name.trim() || !photoUrl}
              data-testid="btn-save-profile"
            >
              {isLoading ? (
                "Tallennetaan..."
              ) : (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Tallenna ja jatka
                </>
              )}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
