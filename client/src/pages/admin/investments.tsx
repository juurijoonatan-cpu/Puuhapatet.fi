/**
 * Investoinnit & Välineet
 * Track equipment purchases — solo or 50/50 split between workers
 */

import { useState, useEffect } from "react";
import { Link } from "wouter";
import { ArrowLeft, Plus, Trash2, Package, Loader2, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { USERS, getAdminProfile } from "@/lib/admin-profile";
import { cn } from "@/lib/utils";

const CATEGORIES = [
  { key: "välineet",    label: "Välineet" },
  { key: "kuljetukset", label: "Kuljetukset" },
  { key: "muu",         label: "Muu" },
];

interface Investment {
  id: number;
  description: string;
  amount: number;
  category: string;
  boughtBy: string;
  splitWith: string | null;
  purchasedAt: string;
  note: string | null;
  createdAt: string;
}

export default function InvestmentsPage() {
  const { toast } = useToast();
  const profile = getAdminProfile();

  const [investments, setInvestments] = useState<Investment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("välineet");
  const [boughtBy, setBoughtBy] = useState(profile?.id ?? USERS[0].id);
  const [splitWith, setSplitWith] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const loadInvestments = () => {
    api.getInvestments().then((res) => {
      if (res.ok && res.data) setInvestments(res.data as Investment[]);
      setLoading(false);
    });
  };

  useEffect(() => { loadInvestments(); }, []);

  const handleAdd = async () => {
    if (!desc.trim() || !amount) return;
    const amountCents = Math.round(parseFloat(amount) * 100);
    if (isNaN(amountCents) || amountCents <= 0) {
      toast({ variant: "destructive", title: "Virheellinen hinta" });
      return;
    }
    setAdding(true);
    const res = await api.addInvestment({
      description: desc.trim(),
      amount: amountCents,
      category,
      boughtBy,
      splitWith: splitWith ?? null,
    });
    if (res.ok) {
      toast({ title: "Hankinta lisätty" });
      setDesc("");
      setAmount("");
      setSplitWith(null);
      setShowForm(false);
      loadInvestments();
    } else {
      toast({ variant: "destructive", title: "Lisäys epäonnistui", description: res.error });
    }
    setAdding(false);
  };

  const handleDelete = async (id: number) => {
    const res = await api.deleteInvestment(id);
    if (res.ok) {
      setInvestments(prev => prev.filter(i => i.id !== id));
      toast({ title: "Poistettu" });
    } else {
      toast({ variant: "destructive", title: "Poisto epäonnistui" });
    }
  };

  const fmt = (cents: number) =>
    (cents / 100).toLocaleString("fi-FI", { style: "currency", currency: "EUR" });

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString("fi-FI", { day: "numeric", month: "short", year: "numeric" });

  // Per-user cost summary (own purchases + half of splits)
  const userTotals: Record<string, number> = {};
  for (const inv of investments) {
    if (inv.splitWith) {
      const half = Math.round(inv.amount / 2);
      userTotals[inv.boughtBy]  = (userTotals[inv.boughtBy]  ?? 0) + half;
      userTotals[inv.splitWith] = (userTotals[inv.splitWith] ?? 0) + half;
    } else {
      userTotals[inv.boughtBy] = (userTotals[inv.boughtBy] ?? 0) + inv.amount;
    }
  }
  const totalAll = investments.reduce((s, i) => s + i.amount, 0);

  const categoryColor = (cat: string) => {
    switch (cat) {
      case "välineet":    return "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300";
      case "kuljetukset": return "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300";
      default:            return "bg-muted text-muted-foreground";
    }
  };

  const otherUser = USERS.find(u => u.id !== boughtBy);

  return (
    <div className="min-h-screen bg-background pt-20 md:pt-24 pb-28">
      <div className="container mx-auto px-4 max-w-3xl">

        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/admin/settings">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-semibold text-foreground">Investoinnit</h1>
            <p className="text-muted-foreground">Välineet ja hankinnat</p>
          </div>
          <Button
            onClick={() => setShowForm(!showForm)}
            variant={showForm ? "outline" : "default"}
            size="sm"
          >
            <Plus className="w-4 h-4 mr-1" />
            Lisää
          </Button>
        </div>

        {/* Summary cards */}
        {investments.length > 0 && (
          <div className="grid grid-cols-3 gap-3 mb-6">
            <Card className="p-4 bg-card border-0 premium-shadow">
              <p className="text-lg font-bold text-foreground">{fmt(totalAll)}</p>
              <p className="text-xs text-muted-foreground">Yhteensä</p>
            </Card>
            {USERS.map(u => (
              <Card key={u.id} className="p-4 bg-card border-0 premium-shadow">
                {u.photoUrl ? (
                  <img src={u.photoUrl} alt={u.name} className="w-6 h-6 rounded-full object-cover mb-1" />
                ) : null}
                <p className="text-lg font-bold text-foreground">{fmt(userTotals[u.id] ?? 0)}</p>
                <p className="text-xs text-muted-foreground">{u.name.split(" ")[0]}</p>
              </Card>
            ))}
          </div>
        )}

        {/* Add form */}
        {showForm && (
          <Card className="p-5 bg-card border-0 premium-shadow mb-6">
            <h3 className="text-sm font-semibold text-foreground mb-4">Uusi hankinta</h3>
            <div className="space-y-3">
              <Input
                placeholder="Kuvaus (esim. ikkunalastat, vesiletku, pyyhin...)"
                value={desc}
                onChange={e => setDesc(e.target.value)}
                className="text-sm"
                onKeyDown={e => e.key === "Enter" && handleAdd()}
              />
              <Input
                type="number"
                placeholder="Hinta (€)"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="text-sm"
                min="0"
                step="0.01"
                onKeyDown={e => e.key === "Enter" && handleAdd()}
              />

              {/* Category */}
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Kategoria</p>
                <div className="flex gap-2 flex-wrap">
                  {CATEGORIES.map(c => (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => setCategory(c.key)}
                      className={cn(
                        "px-3 py-1.5 rounded-full text-xs font-medium border-2 transition-all",
                        category === c.key
                          ? "border-primary bg-primary/5 text-foreground"
                          : "border-border text-muted-foreground hover:border-muted-foreground/40",
                      )}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Paid by */}
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Maksoi</p>
                <div className="flex gap-2 flex-wrap">
                  {USERS.map(u => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => { setBoughtBy(u.id); setSplitWith(null); }}
                      className={cn(
                        "flex items-center gap-2 px-3 py-1.5 rounded-xl border-2 text-sm font-medium transition-all",
                        boughtBy === u.id
                          ? "border-primary bg-primary/5 text-foreground"
                          : "border-border text-muted-foreground hover:border-muted-foreground/40",
                      )}
                    >
                      {u.photoUrl && (
                        <img src={u.photoUrl} alt={u.name} className="w-4 h-4 rounded-full object-cover" />
                      )}
                      {u.name.split(" ")[0]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Split */}
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Jaetaan 50/50?</p>
                <div className="flex gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setSplitWith(null)}
                    className={cn(
                      "px-3 py-1.5 rounded-xl border-2 text-sm font-medium transition-all",
                      !splitWith
                        ? "border-primary bg-primary/5 text-foreground"
                        : "border-border text-muted-foreground hover:border-muted-foreground/40",
                    )}
                  >
                    Oma kulu
                  </button>
                  {otherUser && (
                    <button
                      type="button"
                      onClick={() => setSplitWith(prev => prev === otherUser.id ? null : otherUser.id)}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-xl border-2 text-sm font-medium transition-all",
                        splitWith === otherUser.id
                          ? "border-primary bg-primary/5 text-foreground"
                          : "border-border text-muted-foreground hover:border-muted-foreground/40",
                      )}
                    >
                      <Users className="w-3.5 h-3.5" />
                      50/50 {otherUser.name.split(" ")[0]}
                    </button>
                  )}
                </div>
                {splitWith && amount && !isNaN(parseFloat(amount)) && parseFloat(amount) > 0 && (
                  <p className="text-xs text-muted-foreground mt-1.5">
                    Kumpikin maksaa: {fmt(Math.round(parseFloat(amount) * 50))}
                  </p>
                )}
              </div>

              <Button
                onClick={handleAdd}
                disabled={adding || !desc.trim() || !amount}
                className="w-full"
              >
                {adding
                  ? <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  : <Plus className="w-4 h-4 mr-2" />
                }
                Tallenna hankinta
              </Button>
            </div>
          </Card>
        )}

        {/* Expensive equipment info */}
        {investments.some(i => i.amount >= 15000) && (
          <Card className="p-4 bg-amber-50 dark:bg-amber-900/20 border-0 premium-shadow mb-4">
            <p className="text-xs font-bold text-amber-800 dark:text-amber-300 mb-1.5">
              Kalliin kaluston käyttö keikalla — näin se hoidetaan
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Jos joku käyttää toisen omistamaa kalustoa (150 €+) keikalla, lisää keikan kuluihin
              <strong> "Kalustovuokra — [omistaja]"</strong> (esim. 10–20 € / keikka).
              Omistaja saa osuuden kertyvistä kulukorvauksista. Sopikaa summa etukäteen.
            </p>
          </Card>
        )}

        {/* List */}
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : investments.length === 0 ? (
          <Card className="p-10 text-center bg-card border-0 premium-shadow">
            <Package className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-40" />
            <p className="text-muted-foreground font-medium">Ei vielä kirjattuja hankintoja</p>
            <p className="text-xs text-muted-foreground mt-1">Lisää ensimmäinen hankinta yllä</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {[...investments]
              .sort((a, b) => new Date(b.purchasedAt).getTime() - new Date(a.purchasedAt).getTime())
              .map(inv => {
                const buyer = USERS.find(u => u.id === inv.boughtBy);
                const splitUser = inv.splitWith ? USERS.find(u => u.id === inv.splitWith) : null;
                const half = Math.round(inv.amount / 2);
                const isExpensive = inv.amount >= 15000; // 150€+
                return (
                  <Card key={inv.id} className={cn(
                    "p-4 bg-card border-0 premium-shadow",
                    isExpensive && "ring-1 ring-amber-200 dark:ring-amber-800"
                  )}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <p className="font-medium text-foreground">{inv.description}</p>
                          <span className={cn("text-xs px-2 py-0.5 rounded-full shrink-0", categoryColor(inv.category))}>
                            {CATEGORIES.find(c => c.key === inv.category)?.label ?? inv.category}
                          </span>
                          {isExpensive && (
                            <span className="text-xs px-2 py-0.5 rounded-full shrink-0 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                              Kallis kalusto
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap">
                          <span>{fmtDate(inv.purchasedAt)}</span>
                          <span>·</span>
                          {buyer?.photoUrl ? (
                            <img src={buyer.photoUrl} alt={buyer.name} className="w-3.5 h-3.5 rounded-full object-cover" />
                          ) : null}
                          <span>{buyer?.name.split(" ")[0] ?? inv.boughtBy}</span>
                          {splitUser ? (
                            <>
                              <span>·</span>
                              <span className="text-blue-600 dark:text-blue-400 font-medium">
                                50/50 & {splitUser.name.split(" ")[0]} · kumpikin {fmt(half)}
                              </span>
                            </>
                          ) : (
                            <span className="text-muted-foreground">· oma kulu</span>
                          )}
                        </div>
                        {isExpensive && (
                          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                            Kun käytetään keikalla → lisää keikan kuluihin "Kalustovuokra — {buyer?.name.split(" ")[0] ?? inv.boughtBy}{splitUser ? ` & ${splitUser.name.split(" ")[0]}` : ""}"
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <p className="text-base font-bold text-foreground">{fmt(inv.amount)}</p>
                        <button
                          type="button"
                          onClick={() => handleDelete(inv.id)}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                          aria-label="Poista"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </Card>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}
