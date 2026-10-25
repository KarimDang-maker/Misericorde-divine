CREATE TABLE diocesan_generation_locks (
  periode_debut DATE NOT NULL,
  periode_fin DATE NOT NULL,
  PRIMARY KEY (periode_debut, periode_fin)
) ENGINE=InnoDB;
