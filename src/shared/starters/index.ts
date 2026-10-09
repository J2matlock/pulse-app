/**
 * Built-in starter templates. Static imports so the bundler includes them;
 * each is validated with parseStarter() when used, like any opened file.
 * The gallery shows groups in the order they first appear here.
 * Authoring guide: plans/generalization/W12-starter-templates.md.
 */
import humanServices from './human-services.json'
import housingCaseManager from './housing-case-manager.json'
import communityHealthWorker from './community-health-worker.json'
import peerRecovery from './peer-recovery.json'
import specialEducation from './special-education.json'
import earlyIntervention from './early-intervention.json'
import internationalStudents from './international-students.json'
import casaAdvocate from './casa-advocate.json'
import veteransServiceOfficer from './veterans-service-officer.json'
import hrGeneralist from './hr-generalist.json'
import grantManager from './grant-manager.json'
import priorAuthorization from './prior-authorization.json'
import representativePayee from './representative-payee.json'
import pastoralCare from './pastoral-care.json'
import refugeeResettlement from './refugee-resettlement.json'
import vocationalRehab from './vocational-rehab.json'
import fleetManager from './fleet-manager.json'
import personalVehicles from './personal-vehicles.json'
import autoService from './auto-service.json'
import treeService from './tree-service.json'
import propertyManager from './property-manager.json'
import salesFollowUps from './sales-follow-ups.json'
import animalRescue from './animal-rescue.json'
import mentoringProgram from './mentoring-program.json'
import guardianship from './guardianship.json'
import fireAlarmInspection from './fire-alarm-inspection.json'
import behaviorAnalyst from './behavior-analyst.json'
import therapyPractice from './therapy-practice.json'
import childcareCenter from './childcare-center.json'
import staffCredentials from './staff-credentials.json'
import businessLicenses from './business-licenses.json'
import workplaceSafety from './workplace-safety.json'
import foodService from './food-service.json'
import schoolNurse from './school-nurse.json'
import providerCredentialing from './provider-credentialing.json'
import volunteerSafety from './volunteer-safety.json'
import driverFiles from './driver-files.json'
import personalDocuments from './personal-documents.json'
import caringForAParent from './caring-for-a-parent.json'

export const BUILTIN_STARTERS: readonly unknown[] = [
  // Human services
  humanServices,
  housingCaseManager,
  communityHealthWorker,
  peerRecovery,
  refugeeResettlement,
  vocationalRehab,
  // Health
  providerCredentialing,
  priorAuthorization,
  behaviorAnalyst,
  therapyPractice,
  // Education and youth
  schoolNurse,
  specialEducation,
  earlyIntervention,
  internationalStudents,
  childcareCenter,
  // Legal and government
  casaAdvocate,
  veteransServiceOfficer,
  representativePayee,
  guardianship,
  // Business
  staffCredentials,
  businessLicenses,
  foodService,
  hrGeneralist,
  grantManager,
  salesFollowUps,
  // Trades and service
  autoService,
  treeService,
  driverFiles,
  fleetManager,
  // Property and safety
  workplaceSafety,
  propertyManager,
  fireAlarmInspection,
  // Animals
  animalRescue,
  // Faith and community
  volunteerSafety,
  pastoralCare,
  mentoringProgram,
  // Personal
  personalDocuments,
  personalVehicles,
  caringForAParent,
]
