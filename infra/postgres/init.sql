-- Role da aplicação: não é dona das tabelas, então as policies de RLS se aplicam a ela (SEC-REQ-16).
CREATE ROLE fruiqo_app LOGIN PASSWORD 'dev_app_password';
GRANT CONNECT ON DATABASE fruiqo TO fruiqo_app;
