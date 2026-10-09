import React from 'react'
import {
  HeartHandshake, Wrench, GraduationCap, Building2, ShieldCheck, Stethoscope, Truck, Users,
  FileBadge, UtensilsCrossed, Church, HardHat, Home, PawPrint, IdCard, Folder, HeartPulse, Sprout, Brain, HandHeart, TreeDeciduous, LayoutTemplate, type LucideIcon,
} from 'lucide-react'

/**
 * Starter files name a lucide icon; only these are bundled (importing every
 * icon would bloat the app). Unknown names fall back to a template icon.
 */
const ICONS: Record<string, LucideIcon> = {
  'heart-handshake': HeartHandshake, wrench: Wrench, 'graduation-cap': GraduationCap, 'building-2': Building2,
  'shield-check': ShieldCheck, stethoscope: Stethoscope, truck: Truck, users: Users, 'file-badge': FileBadge,
  'utensils-crossed': UtensilsCrossed, church: Church, 'hard-hat': HardHat, home: Home, 'paw-print': PawPrint,
  'id-card': IdCard, folder: Folder, 'heart-pulse': HeartPulse, sprout: Sprout,
  brain: Brain, 'hand-heart': HandHeart, 'tree-deciduous': TreeDeciduous,
}

export function StarterIcon({ name, className }: { name: string; className?: string }): React.ReactElement {
  const Icon = ICONS[name] ?? LayoutTemplate
  return <Icon className={className} aria-hidden="true" />
}
