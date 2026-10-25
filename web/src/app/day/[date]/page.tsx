"use client";

import { useParams } from "next/navigation";
import { DayView } from "@/components/DayView";

export default function DayPage() {
  const { date } = useParams<{ date: string }>();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return <p className="text-muted">That isn&apos;t a valid date.</p>;
  return <DayView key={date} initialDate={date} />;
}
