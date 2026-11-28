/** Courses: her plans of lectures, and a syllabus read into one (COURSE-1 to COURSE-7). */
import { CourseDetail, CourseList, SyllabusPreview, type CreateCourse, type UpdateUnits } from '@nyaai/shared';
import { fileType } from '@/shared/lib/files';
import { call, sendFile } from './http';

export const coursesApi = {
  courses: () => call('GET', '/courses', { parse: (v) => CourseList.parse(v) }),
  course: (id: string) => call('GET', `/courses/${id}`, { parse: (v) => CourseDetail.parse(v) }),
  createCourse: (body: CreateCourse) => call('POST', '/courses', { body, parse: (v) => CourseDetail.parse(v) }),
  updateUnits: (id: string, body: UpdateUnits) =>
    call('PATCH', `/courses/${id}/units`, { body, parse: (v) => CourseDetail.parse(v) }),
  /** Her syllabus, read into units and topics (nothing is kept on the server). */
  readSyllabus: (file: File, classCount?: number) =>
    sendFile(`/courses/syllabus${classCount ? `?classCount=${classCount}` : ''}`, file, fileType(file), (v) =>
      SyllabusPreview.parse(v),
    ),
};

/** The list and each course have their own keys. */
export const courseKeys = {
  courses: ['courses', 'list'] as const,
  course: (id: string) => ['courses', 'detail', id] as const,
};
