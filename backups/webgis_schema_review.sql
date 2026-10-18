--
-- PostgreSQL database dump
--

\restrict 5HxYbNqQAo3bUNQ0QBsJsMlMTOIs6OYLNdjjixWc10RWaTjNj8JGbpujOsVBBAd

-- Dumped from database version 16.4 (Debian 16.4-1.pgdg110+2)
-- Dumped by pg_dump version 16.4 (Debian 16.4-1.pgdg110+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: topology; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA topology;


--
-- Name: SCHEMA topology; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA topology IS 'PostGIS Topology schema';


--
-- Name: fuzzystrmatch; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS fuzzystrmatch WITH SCHEMA public;


--
-- Name: EXTENSION fuzzystrmatch; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION fuzzystrmatch IS 'determine similarities and distance between strings';


--
-- Name: postgis; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;


--
-- Name: EXTENSION postgis; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION postgis IS 'PostGIS geometry and geography spatial types and functions';


--
-- Name: postgis_topology; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis_topology WITH SCHEMA topology;


--
-- Name: EXTENSION postgis_topology; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION postgis_topology IS 'PostGIS topology spatial types and functions';


--
-- Name: update_admin_users_timestamp(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_admin_users_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: admin_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_users (
    id bigint NOT NULL,
    username character varying(50) NOT NULL,
    password_hash text NOT NULL,
    role character varying(20) DEFAULT 'viewer'::character varying NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    failed_login_attempts integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_admin_users_failed_attempts CHECK ((failed_login_attempts >= 0)),
    CONSTRAINT chk_admin_users_role CHECK (((role)::text = ANY ((ARRAY['admin'::character varying, 'viewer'::character varying])::text[])))
);


--
-- Name: TABLE admin_users; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.admin_users IS 'B???ng l??u tr??? th??ng tin t??i kho???n qu???n tr??? v?? ph??n quy???n h??? th???ng WebGIS MSVT';


--
-- Name: COLUMN admin_users.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.admin_users.id IS 'Kh??a ch??nh ?????nh danh ng?????i d??ng';


--
-- Name: COLUMN admin_users.username; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.admin_users.username IS 'T??n ????ng nh???p duy nh???t (t???i ??a 50 k?? t???)';


--
-- Name: COLUMN admin_users.password_hash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.admin_users.password_hash IS 'Chu???i b??m m???t kh???u b???ng thu???t to??n Argon2id';


--
-- Name: COLUMN admin_users.role; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.admin_users.role IS 'Vai tr?? ph??n quy???n: admin (to??n quy???n) ho???c viewer (ch??? xem)';


--
-- Name: COLUMN admin_users.is_active; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.admin_users.is_active IS 'Tr???ng th??i ho???t ?????ng c???a t??i kho???n (true: k??ch ho???t, false: kh??a)';


--
-- Name: COLUMN admin_users.failed_login_attempts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.admin_users.failed_login_attempts IS 'S??? l???n ????ng nh???p th???t b???i li??n ti???p (d??ng ch???ng brute-force)';


--
-- Name: COLUMN admin_users.locked_until; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.admin_users.locked_until IS 'Th???i ??i???m h???t h???n kh??a t??i kho???n khi v?????t qu?? gi???i h???n th??? sai';


--
-- Name: COLUMN admin_users.last_login_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.admin_users.last_login_at IS 'Th???i ??i???m ????ng nh???p th??nh c??ng g???n nh???t';


--
-- Name: COLUMN admin_users.created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.admin_users.created_at IS 'Th???i ??i???m kh???i t???o b???n ghi';


--
-- Name: COLUMN admin_users.updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.admin_users.updated_at IS 'Th???i ??i???m c???p nh???t b???n ghi g???n nh???t';


--
-- Name: admin_users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.admin_users ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.admin_users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: msvt_import_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.msvt_import_jobs (
    id character varying(50) NOT NULL,
    filename character varying(255) NOT NULL,
    file_hash character varying(64) NOT NULL,
    uploaded_by bigint,
    sheet_name character varying(100),
    header_row integer DEFAULT 1,
    data_start_row integer DEFAULT 2,
    mapping_config jsonb,
    total_rows integer DEFAULT 0 NOT NULL,
    valid_count integer DEFAULT 0 NOT NULL,
    warning_count integer DEFAULT 0 NOT NULL,
    duplicate_count integer DEFAULT 0 NOT NULL,
    error_count integer DEFAULT 0 NOT NULL,
    imported_count integer DEFAULT 0 NOT NULL,
    status character varying(30) DEFAULT 'uploaded'::character varying NOT NULL,
    validated_rows jsonb,
    import_result jsonb,
    temp_file_path character varying(500),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    committed_at timestamp with time zone
);


--
-- Name: TABLE msvt_import_jobs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.msvt_import_jobs IS 'Bảng lưu vết các phiên nhập dữ liệu MSVT từ file Excel';


--
-- Name: COLUMN msvt_import_jobs.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.msvt_import_jobs.status IS 'Trạng thái phiên nhập: uploaded, validated, committed, cancelled, failed';


--
-- Name: vung_trong; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vung_trong (
    id bigint NOT NULL,
    msvt_moi text,
    msvt_cu text,
    to_chuc_ca_nhan text,
    nguoi_dai_dien text,
    so_dien_thoai text,
    email text,
    toa_do_goc text,
    dia_chi_msvt text,
    loai_cay_trong text,
    so_ho_tham_gia integer,
    dien_tich_ha numeric(14,4),
    san_luong_tan_ha numeric(14,4),
    quy_trinh text,
    thi_truong text,
    vi_tri public.geometry(Point,4326),
    ranh_gioi public.geometry(MultiPolygon,4326),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    tong_san_luong_tan numeric(14,4),
    is_deleted boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by bigint,
    CONSTRAINT check_dien_tich_ha CHECK (((dien_tich_ha IS NULL) OR (dien_tich_ha >= (0)::numeric))),
    CONSTRAINT check_san_luong_tan_ha CHECK (((san_luong_tan_ha IS NULL) OR (san_luong_tan_ha >= (0)::numeric))),
    CONSTRAINT check_so_ho_tham_gia CHECK (((so_ho_tham_gia IS NULL) OR (so_ho_tham_gia >= 0))),
    CONSTRAINT check_tong_san_luong_tan CHECK (((tong_san_luong_tan IS NULL) OR (tong_san_luong_tan >= (0)::numeric)))
);


--
-- Name: COLUMN vung_trong.is_deleted; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.vung_trong.is_deleted IS 'C??? ????nh d???u x??a m???m (true: ???? x??a, false: ??ang ho???t ?????ng)';


--
-- Name: COLUMN vung_trong.deleted_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.vung_trong.deleted_at IS 'Th???i ??i???m b???n ghi b??? x??a m???m';


--
-- Name: COLUMN vung_trong.deleted_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.vung_trong.deleted_by IS 'ID c???a t??i kho???n admin th???c hi???n thao t??c x??a m???m';


--
-- Name: vung_trong_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.vung_trong ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.vung_trong_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: admin_users admin_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_pkey PRIMARY KEY (id);


--
-- Name: msvt_import_jobs msvt_import_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.msvt_import_jobs
    ADD CONSTRAINT msvt_import_jobs_pkey PRIMARY KEY (id);


--
-- Name: admin_users uq_admin_users_username; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT uq_admin_users_username UNIQUE (username);


--
-- Name: vung_trong vung_trong_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vung_trong
    ADD CONSTRAINT vung_trong_pkey PRIMARY KEY (id);


--
-- Name: idx_admin_users_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_users_role ON public.admin_users USING btree (role);


--
-- Name: idx_admin_users_username; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_users_username ON public.admin_users USING btree (username);


--
-- Name: idx_msvt_import_jobs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_msvt_import_jobs_created_at ON public.msvt_import_jobs USING btree (created_at DESC);


--
-- Name: idx_msvt_import_jobs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_msvt_import_jobs_status ON public.msvt_import_jobs USING btree (status);


--
-- Name: idx_msvt_import_jobs_uploaded_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_msvt_import_jobs_uploaded_by ON public.msvt_import_jobs USING btree (uploaded_by);


--
-- Name: idx_vung_trong_is_deleted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vung_trong_is_deleted ON public.vung_trong USING btree (is_deleted);


--
-- Name: idx_vung_trong_msvt_cu; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vung_trong_msvt_cu ON public.vung_trong USING btree (msvt_cu);


--
-- Name: idx_vung_trong_msvt_moi; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vung_trong_msvt_moi ON public.vung_trong USING btree (msvt_moi);


--
-- Name: idx_vung_trong_ranh_gioi; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vung_trong_ranh_gioi ON public.vung_trong USING gist (ranh_gioi);


--
-- Name: idx_vung_trong_vi_tri; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vung_trong_vi_tri ON public.vung_trong USING gist (vi_tri);


--
-- Name: admin_users trg_update_admin_users_timestamp; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_update_admin_users_timestamp BEFORE UPDATE ON public.admin_users FOR EACH ROW EXECUTE FUNCTION public.update_admin_users_timestamp();


--
-- Name: vung_trong trg_vung_trong_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_vung_trong_updated_at BEFORE UPDATE ON public.vung_trong FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: vung_trong fk_vung_trong_deleted_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vung_trong
    ADD CONSTRAINT fk_vung_trong_deleted_by FOREIGN KEY (deleted_by) REFERENCES public.admin_users(id) ON DELETE SET NULL;


--
-- Name: msvt_import_jobs msvt_import_jobs_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.msvt_import_jobs
    ADD CONSTRAINT msvt_import_jobs_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.admin_users(id) ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

\unrestrict 5HxYbNqQAo3bUNQ0QBsJsMlMTOIs6OYLNdjjixWc10RWaTjNj8JGbpujOsVBBAd

