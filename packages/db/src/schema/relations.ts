import { relations } from "drizzle-orm/relations";
import { colleges, inviteAllowlist, users, consents, templates, courses, courseUnits, lectures, lectureInputs, slides, slideVersions, researchRuns, researchQuestions, evidenceItems, sources, legalConcepts, conceptLinks, coverageItems, citations, chunks, caseTreatments, teacherProfiles, libraryGaps, lawMappings, lawMappingItems, libraryGapAskers } from "./schema";

export const inviteAllowlistRelations = relations(inviteAllowlist, ({one}) => ({
	college: one(colleges, {
		fields: [inviteAllowlist.collegeId],
		references: [colleges.id]
	}),
	user: one(users, {
		fields: [inviteAllowlist.invitedBy],
		references: [users.id]
	}),
}));

export const collegesRelations = relations(colleges, ({many}) => ({
	inviteAllowlists: many(inviteAllowlist),
	users: many(users),
	libraryGaps: many(libraryGaps),
}));

export const usersRelations = relations(users, ({one, many}) => ({
	inviteAllowlists: many(inviteAllowlist),
	consents: many(consents),
	templates: many(templates),
	courses: many(courses),
	sources: many(sources),
	lectures: many(lectures),
	college: one(colleges, {
		fields: [users.collegeId],
		references: [colleges.id]
	}),
	teacherProfiles: many(teacherProfiles),
	libraryGaps: many(libraryGaps),
	libraryGapAskers: many(libraryGapAskers),
}));

export const consentsRelations = relations(consents, ({one}) => ({
	user: one(users, {
		fields: [consents.ownerId],
		references: [users.id]
	}),
}));

export const templatesRelations = relations(templates, ({one, many}) => ({
	user: one(users, {
		fields: [templates.ownerId],
		references: [users.id]
	}),
	teacherProfiles: many(teacherProfiles),
}));

export const coursesRelations = relations(courses, ({one, many}) => ({
	user: one(users, {
		fields: [courses.ownerId],
		references: [users.id]
	}),
	courseUnits: many(courseUnits),
	lectures: many(lectures),
}));

export const courseUnitsRelations = relations(courseUnits, ({one, many}) => ({
	course: one(courses, {
		fields: [courseUnits.courseId],
		references: [courses.id]
	}),
	lectures: many(lectures),
}));

export const lectureInputsRelations = relations(lectureInputs, ({one}) => ({
	lecture: one(lectures, {
		fields: [lectureInputs.lectureId],
		references: [lectures.id]
	}),
}));

export const lecturesRelations = relations(lectures, ({one, many}) => ({
	lectureInputs: many(lectureInputs),
	slides: many(slides),
	user: one(users, {
		fields: [lectures.ownerId],
		references: [users.id]
	}),
	course: one(courses, {
		fields: [lectures.courseId],
		references: [courses.id]
	}),
	courseUnit: one(courseUnits, {
		fields: [lectures.unitId],
		references: [courseUnits.id]
	}),
	coverageItems: many(coverageItems),
	citations: many(citations),
}));

export const slidesRelations = relations(slides, ({one, many}) => ({
	lecture: one(lectures, {
		fields: [slides.lectureId],
		references: [lectures.id]
	}),
	slideVersions: many(slideVersions),
}));

export const slideVersionsRelations = relations(slideVersions, ({one}) => ({
	slide: one(slides, {
		fields: [slideVersions.slideId],
		references: [slides.id]
	}),
}));

export const researchQuestionsRelations = relations(researchQuestions, ({one, many}) => ({
	researchRun: one(researchRuns, {
		fields: [researchQuestions.runId],
		references: [researchRuns.id]
	}),
	evidenceItems: many(evidenceItems),
}));

export const researchRunsRelations = relations(researchRuns, ({many}) => ({
	researchQuestions: many(researchQuestions),
	evidenceItems: many(evidenceItems),
}));

export const evidenceItemsRelations = relations(evidenceItems, ({one}) => ({
	researchRun: one(researchRuns, {
		fields: [evidenceItems.runId],
		references: [researchRuns.id]
	}),
	researchQuestion: one(researchQuestions, {
		fields: [evidenceItems.questionId],
		references: [researchQuestions.id]
	}),
}));

export const sourcesRelations = relations(sources, ({one, many}) => ({
	user: one(users, {
		fields: [sources.ownerId],
		references: [users.id]
	}),
	conceptLinks: many(conceptLinks),
	chunks: many(chunks),
	caseTreatments_citedSourceId: many(caseTreatments, {
		relationName: "caseTreatments_citedSourceId_sources_id"
	}),
	caseTreatments_citingSourceId: many(caseTreatments, {
		relationName: "caseTreatments_citingSourceId_sources_id"
	}),
}));

export const legalConceptsRelations = relations(legalConcepts, ({one, many}) => ({
	legalConcept: one(legalConcepts, {
		fields: [legalConcepts.parentId],
		references: [legalConcepts.id],
		relationName: "legalConcepts_parentId_legalConcepts_id"
	}),
	legalConcepts: many(legalConcepts, {
		relationName: "legalConcepts_parentId_legalConcepts_id"
	}),
	conceptLinks: many(conceptLinks),
}));

export const conceptLinksRelations = relations(conceptLinks, ({one}) => ({
	legalConcept: one(legalConcepts, {
		fields: [conceptLinks.conceptId],
		references: [legalConcepts.id]
	}),
	source: one(sources, {
		fields: [conceptLinks.sourceId],
		references: [sources.id]
	}),
}));

export const coverageItemsRelations = relations(coverageItems, ({one}) => ({
	lecture: one(lectures, {
		fields: [coverageItems.lectureId],
		references: [lectures.id]
	}),
	citation: one(citations, {
		fields: [coverageItems.coveredBy],
		references: [citations.id]
	}),
}));

export const citationsRelations = relations(citations, ({one, many}) => ({
	coverageItems: many(coverageItems),
	lecture: one(lectures, {
		fields: [citations.lectureId],
		references: [lectures.id]
	}),
}));

export const chunksRelations = relations(chunks, ({one, many}) => ({
	source: one(sources, {
		fields: [chunks.sourceId],
		references: [sources.id]
	}),
	chunk: one(chunks, {
		fields: [chunks.parentId],
		references: [chunks.id],
		relationName: "chunks_parentId_chunks_id"
	}),
	chunks: many(chunks, {
		relationName: "chunks_parentId_chunks_id"
	}),
}));

export const caseTreatmentsRelations = relations(caseTreatments, ({one}) => ({
	source_citedSourceId: one(sources, {
		fields: [caseTreatments.citedSourceId],
		references: [sources.id],
		relationName: "caseTreatments_citedSourceId_sources_id"
	}),
	source_citingSourceId: one(sources, {
		fields: [caseTreatments.citingSourceId],
		references: [sources.id],
		relationName: "caseTreatments_citingSourceId_sources_id"
	}),
}));

export const teacherProfilesRelations = relations(teacherProfiles, ({one}) => ({
	user: one(users, {
		fields: [teacherProfiles.ownerId],
		references: [users.id]
	}),
	template: one(templates, {
		fields: [teacherProfiles.templateId],
		references: [templates.id]
	}),
}));

export const libraryGapsRelations = relations(libraryGaps, ({one, many}) => ({
	college: one(colleges, {
		fields: [libraryGaps.collegeId],
		references: [colleges.id]
	}),
	user: one(users, {
		fields: [libraryGaps.resolvedBy],
		references: [users.id]
	}),
	libraryGapAskers: many(libraryGapAskers),
}));

export const lawMappingItemsRelations = relations(lawMappingItems, ({one}) => ({
	lawMapping: one(lawMappings, {
		fields: [lawMappingItems.mappingId],
		references: [lawMappings.id]
	}),
}));

export const lawMappingsRelations = relations(lawMappings, ({many}) => ({
	lawMappingItems: many(lawMappingItems),
}));

export const libraryGapAskersRelations = relations(libraryGapAskers, ({one}) => ({
	libraryGap: one(libraryGaps, {
		fields: [libraryGapAskers.gapId],
		references: [libraryGaps.id]
	}),
	user: one(users, {
		fields: [libraryGapAskers.ownerId],
		references: [users.id]
	}),
}));