-- Enable PostGIS extension for WebGIS MSVT
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;

-- Optional useful GIS extensions
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

DO $$
BEGIN
    RAISE NOTICE 'PostGIS extension initialized successfully in database %', current_database();
END $$;
