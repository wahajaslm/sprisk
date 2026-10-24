-- A question's walks are listed by it (ADR-0064), newest first.
CREATE INDEX walks_by_question ON walks (question_version_id, id);
