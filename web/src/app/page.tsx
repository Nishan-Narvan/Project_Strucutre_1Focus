"use client";

import { DayView } from "@/components/DayView";
import { today } from "@/lib/date";

export default function TodayPage() {
  return <DayView initialDate={today()} />;
}
